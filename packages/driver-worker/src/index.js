import { convertUnit, setRem } from 'style-unit';
import createDocument from './create-document';

const TO_SANITIZE = [
  'addedNodes',
  'removedNodes',
  'nextSibling',
  'previousSibling',
  'target'
];

const DANGEROUSLY_SET_INNER_HTML = 'dangerouslySetInnerHTML';
const CLASS_NAME = 'className';
const CLASS = 'class';
const STYLE = 'style';
const CHILDREN = 'children';
const EVENT_PREFIX_REGEXP = /^on[A-Z]/;

const ADD_EVENT = 'addEvent';
const REMOVE_EVENT = 'removeEvent';

export default ({ postMessage, addEventListener }) => {
  let document = createDocument();
  let MutationObserver = document.defaultView.MutationObserver;

  const NODES = new Map();
  let COUNTER = 0;

  function getNode(node) {
    let id;
    if (node && typeof node === 'object') id = node.$$id;
    if (typeof node === 'string') id = node;
    if (!id) return null;
    if (node.nodeName === 'BODY') return document.body;
    return NODES.get(id);
  }

  function handleEvent(event) {
    let target = getNode(event.target);
    if (target) {
      event.target = target;
      target.dispatchEvent(event);
    }
  }

  function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) return obj.map(sanitize);

    if (obj instanceof document.defaultView.Node) {
      let id = obj.$$id;
      if (!id) {
        id = obj.$$id = String(++COUNTER);
      }
      NODES.set(id, obj);
    }

    let out = {
      $$id: obj.$$id,
      events: Object.keys(obj.eventListeners || {}),
      attributes: obj.attributes,
      nodeName: obj.nodeName,
      nodeType: obj.nodeType,
      style: obj.style,
      childNodes: obj.childNodes,
      data: obj.data
    };

    if (out.childNodes && out.childNodes.length) {
      out.childNodes = sanitize(out.childNodes);
    }

    return out;
  }

  let mutationObserver = new MutationObserver(mutations => {
    for (let i = mutations.length; i--; ) {
      let mutation = mutations[i];
      for (let j = TO_SANITIZE.length; j--; ) {
        let prop = TO_SANITIZE[j];
        mutation[prop] = sanitize(mutation[prop]);
      }
    }
    send({ type: 'MutationRecord', mutations });
  });

  mutationObserver.observe(document, { subtree: true });

  function send(message) {
    postMessage(JSON.parse(JSON.stringify(message)));
  }

  addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'init':
        document.URL = data.url;
        document.documentElement.clientWidth = data.width;
        break;
      case 'event':
        handleEvent(data.event);
        break;
    }
  });

  return {
    deviceWidth: null,
    viewportWidth: 750,
    eventRegistry: {},

    getDeviceWidth() {
      return this.deviceWidth || document.documentElement.clientWidth;
    },

    setDeviceWidth(width) {
      this.deviceWidth = width;
    },

    getViewportWidth() {
      return this.viewportWidth;
    },

    setViewportWidth(width) {
      this.viewportWidth = width;
    },

    getElementById(id) {
      return document.getElementById(id);
    },

    createBody() {
      return document.body;
    },

    createComment(content) {
      return document.createComment(content);
    },

    createEmpty() {
      return this.createComment(' empty ');
    },

    createText(text) {
      return document.createTextNode(text);
    },

    updateText(node, text) {
      node.textContent = text;
    },

    createElement(component) {
      let node = document.createElement(component.type);
      let props = component.props;

      this.setNativeProps(node, props);

      return node;
    },

    appendChild(node, parent) {
      return parent.appendChild(node);
    },

    removeChild(node, parent) {
      parent = parent || node.parentNode;
      // Maybe has been removed when remove child
      if (parent) {
        parent.removeChild(node);
      }
    },

    replaceChild(newChild, oldChild, parent) {
      parent = parent || oldChild.parentNode;
      parent.replaceChild(newChild, oldChild);
    },

    insertAfter(node, after, parent) {
      parent = parent || after.parentNode;
      const nextSibling = after.nextSibling;
      if (nextSibling) {
        parent.insertBefore(node, nextSibling);
      } else {
        parent.appendChild(node);
      }
    },

    insertBefore(node, before, parent) {
      parent = parent || before.parentNode;
      parent.insertBefore(node, before);
    },

    addEventListener(node, eventName, eventHandler, props) {
      if (this.eventRegistry[eventName]) {
        return this.eventRegistry[eventName](
          ADD_EVENT,
          node,
          eventName,
          eventHandler,
          props
        );
      } else {
        return node.addEventListener(eventName, eventHandler);
      }
    },

    removeEventListener(node, eventName, eventHandler, props) {
      if (this.eventRegistry[eventName]) {
        return this.eventRegistry[eventName](
          REMOVE_EVENT,
          node,
          eventName,
          eventHandler,
          props
        );
      } else {
        return node.removeEventListener(eventName, eventHandler);
      }
    },

    removeAllEventListeners(node) {
      // noop
    },

    removeAttribute(node, propKey) {
      if (propKey === DANGEROUSLY_SET_INNER_HTML) {
        return node.innerHTML = null;
      }

      if (propKey === CLASS_NAME) {
        propKey = CLASS;
      }

      if (propKey in node) {
        try {
          // Some node property is readonly when in strict mode
          node[propKey] = null;
        } catch (e) {}
      }

      node.removeAttribute(propKey);
    },

    setAttribute(node, propKey, propValue) {
      if (propKey === DANGEROUSLY_SET_INNER_HTML) {
        return node.innerHTML = propValue.__html;
      }

      if (propKey === CLASS_NAME) {
        propKey = CLASS;
      }

      if (propKey in node) {
        try {
          // Some node property is readonly when in strict mode
          node[propKey] = propValue;
        } catch (e) {
          node.setAttribute(propKey, propValue);
        }
      } else {
        node.setAttribute(propKey, propValue);
      }
    },

    setStyles(node, styles) {
      let tranformedStyles = {};

      for (let prop in styles) {
        let val = styles[prop];
        tranformedStyles[prop] = convertUnit(val, prop);
      }

      for (let prop in tranformedStyles) {
        const transformValue = tranformedStyles[prop];
        // hack handle compatibility issue
        if (Array.isArray(transformValue)) {
          for (let i = 0; i < transformValue.length; i++) {
            node.style[prop] = transformValue[i];
          }
        } else {
          node.style[prop] = transformValue;
        }
      }
    },

    beforeRender() {
      // Init rem unit
      setRem(this.getDeviceWidth() / this.getViewportWidth());
    },

    setNativeProps(node, props) {
      for (let prop in props) {
        let value = props[prop];
        if (prop === CHILDREN) {
          continue;
        }

        if (value != null) {
          if (prop === STYLE) {
            this.setStyles(node, value);
          } else if (EVENT_PREFIX_REGEXP.test(prop)) {
            let eventName = prop.slice(2).toLowerCase();
            this.addEventListener(node, eventName, value);
          } else {
            this.setAttribute(node, prop, value);
          }
        }
      }
    }
  };
};
