// dom_dehydrator.js - In-page DOM Dehydrator inspired by Alibaba Page-Agent
// Extracts a token-efficient "FlatDomTree" and interactive element hierarchy.

/**
 * Scans and dehydrates the DOM in the active page context.
 * Can be passed directly to chrome.scripting.executeScript({ func: DomDehydrator.scanPage }).
 * @returns {Object}
 */
function scanPage() {
  const MAX_TEXT_LEN = 120;
  const MAX_ELEMENTS = 150;

    function isVisible(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function getUniqueSelector(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
      if (el.id) {
        return '#' + CSS.escape(el.id);
      }

      let path = [];
      let curr = el;
      while (curr && curr.nodeType === Node.ELEMENT_NODE && curr !== document.body && curr !== document.documentElement) {
        let tag = curr.tagName.toLowerCase();
        if (curr.id) {
          path.unshift('#' + CSS.escape(curr.id));
          break;
        }

        let selector = tag;
        if (curr.className && typeof curr.className === 'string') {
          const classes = curr.className.trim().split(/\s+/).filter((c) => !c.includes(':') && !c.includes('/'));
          if (classes.length > 0) {
            selector += '.' + CSS.escape(classes[0]);
          }
        }

        let sibling = curr;
        let nth = 1;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName.toLowerCase() === tag) nth++;
        }
        if (nth > 1) {
          selector += ':nth-of-type(' + nth + ')';
        }

        path.unshift(selector);
        curr = curr.parentElement;
      }
      return path.join(' > ');
    }

    const elements = [];
    const ignoredTags = new Set(['script', 'style', 'noscript', 'meta', 'link', 'svg', 'path', 'defs']);

    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const tag = node.tagName.toLowerCase();
          if (ignoredTags.has(tag)) return NodeFilter.FILTER_REJECT;
          if (!isVisible(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode()) && elements.length < MAX_ELEMENTS) {
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role') || '';
      const isInteractive =
        ['button', 'a', 'input', 'textarea', 'select', 'details', 'summary'].includes(tag) ||
        role.includes('button') ||
        role.includes('link') ||
        role.includes('checkbox') ||
        node.hasAttribute('onclick') ||
        node.hasAttribute('tabindex');

      const isHeading = /^h[1-6]$/.test(tag);
      const isLandmark = ['header', 'nav', 'main', 'footer', 'aside', 'article', 'section'].includes(tag);
      const hasAdKeywords = /(ad|banner|sponsor|promo|cookie|modal|popup|sticky)/i.test(
        (node.id || '') + ' ' + (node.className || '')
      );

      // Only retain nodes that are interactive, headings, landmarks, ads, or have explicit IDs
      if (isInteractive || isHeading || isLandmark || hasAdKeywords || (node.id && node.children.length === 0)) {
        const directText = Array.from(node.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent.trim())
          .filter(Boolean)
          .join(' ');

        const rawText = directText || (node.innerText ? node.innerText.trim().slice(0, MAX_TEXT_LEN) : '');
        const cleanText = rawText.replace(/\s+/g, ' ').slice(0, MAX_TEXT_LEN);

        const selector = getUniqueSelector(node);
        const rect = node.getBoundingClientRect();

        elements.push({
          tag,
          id: node.id || undefined,
          classes: node.className && typeof node.className === 'string' ? node.className.trim() : undefined,
          role: role || undefined,
          type: node.getAttribute('type') || undefined,
          placeholder: node.getAttribute('placeholder') || undefined,
          text: cleanText || undefined,
          selector,
          isInteractive,
          isHeading,
          isAd: hasAdKeywords,
          rect: {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        });
      }
    }

    return {
      url: window.location.href,
      title: document.title,
      elementCount: elements.length,
      elements: elements
    };
  }

  const DomDehydrator = {
    scanPage: scanPage,

    /**
     * Formats the dehydrated DOM into a compact markdown summary for Gemini.
     * @param {Object} data Dehydrated DOM object
     * @returns {string}
     */
    formatForPrompt(data) {
    if (!data || !data.elements) {
      return 'No DOM elements found.';
    }

    let out = `## Page: "${data.title}"\nURL: ${data.url}\nTotal Key Elements Scanned: ${data.elements.length}\n\n`;
    out += `| Tag | Selector | ID / Class | Text / Placeholder | Notes |\n`;
    out += `| :--- | :--- | :--- | :--- | :--- |\n`;

    for (const el of data.elements) {
      const tag = el.tag;
      const selector = el.selector || '';
      const idOrClass = (el.id ? '#' + el.id : '') + (el.classes ? ' .' + el.classes.split(' ')[0] : '');
      const text = (el.text || el.placeholder || '').replace(/\|/g, '\\|');
      const notes = [
        el.isInteractive ? 'interactive' : '',
        el.isHeading ? 'heading' : '',
        el.isAd ? 'potential-ad/banner' : ''
      ]
        .filter(Boolean)
        .join(', ');

      out += `| \`${tag}\` | \`${selector}\` | ${idOrClass} | ${text} | ${notes} |\n`;
    }

    return out;
  },

  /**
   * Returns a self-invoking script string for injecting into contexts where a function reference cannot be passed.
   * @returns {string}
   */
  getInjectionScript() {
    return '(' + this.scanPage.toString() + ')()';
  }
};

window.DomDehydrator = DomDehydrator;
