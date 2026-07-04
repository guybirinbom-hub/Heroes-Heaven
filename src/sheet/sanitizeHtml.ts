import DOMPurify from 'dompurify';

/**
 * Allowlist HTML sanitizer for every piece of user-authored / imported description HTML that the app
 * renders via dangerouslySetInnerHTML (see DescBody). The old regex sanitizer was bypassable
 * (unquoted `href=javascript:`, `on…=` with no leading space, entity-encoded `java&#115;cript:`, a
 * stray `>` inside an attribute value). This routes the string through DOMPurify's real HTML parser
 * with a conservative allowlist appropriate to game-rules prose + the app's own rich-text editor.
 *
 * WHY THIS MATTERS HERE: in the Tauri WebView the page has IPC access to privileged Rust commands
 * (including uninstall_app) and to all localStorage, so a script injected through a shared
 * .codex / Wanderer's-Guide / homebrew description would be genuine code execution — not just a
 * defaced page. Untrusted HTML must never reach the DOM unsanitized.
 */

// Formatting/structure tags that actually appear in descriptions (curated SRD prose after import,
// pasted markup, and the RichEditor/Notes toolbars: bold/italic/underline/strike, headings, lists,
// blockquote, dividers, tables, code, and the color spans/fonts execCommand emits). No embedding
// (img/iframe/object/embed/video/audio), no script/style/form.
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'code', 'small',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'a',
  // Legacy note content: execCommand foreColor/hiliteColor historically emitted <font>.
  'font',
];

// `class` + `data-ref-key`/`data-ref-id` drive the in-description .ref-link navigation (DescBody's
// click handler reads dataset.refKey/refId). `href` on <a> is scheme-filtered below. `style`/`color`
// carry the Notes/RichEditor text + highlight colors (styleWithCSS emits inline style spans); the
// style value itself is sanitized by DOMPurify's CSS filter, and target/rel harden external links.
const ALLOWED_ATTR = [
  'class', 'href', 'title', 'target', 'rel', 'style', 'color',
  'data-ref-key', 'data-ref-id',
  'colspan', 'rowspan',
];

// Only real navigable schemes; NO javascript:/data:/vbscript:. DOMPurify's own URI regex already
// blocks dangerous schemes, but we keep this explicit as the app never needs mailto/tel/etc.
const ALLOWED_URI = /^(?:https?:|#)/i;

let configured = false;
function ensureHooks() {
  if (configured) return;
  configured = true;
  // Belt-and-suspenders on top of ALLOWED_ATTR/URI: strip any residual event handler and re-check
  // every href/src against the scheme allowlist (guards decoded/edge-case values the parser produced).
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    if (!el.getAttributeNames) return;
    for (const name of el.getAttributeNames()) {
      if (/^on/i.test(name)) el.removeAttribute(name);
    }
    for (const attr of ['href', 'src'] as const) {
      const v = el.getAttribute?.(attr);
      if (v != null && !ALLOWED_URI.test(v.trim())) el.removeAttribute(attr);
    }
    // Harden any surviving external link so it can't reach back into window.opener.
    if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/** Sanitize untrusted description/notes HTML to a safe subset before rendering it into the DOM.
 *  DOMPurify needs a DOM; in a DOM-less context (node import-time defense-in-depth, SSR) it can't run,
 *  so we pass the string through unchanged — every render path goes back through this in the WebView,
 *  where a DOM exists, so nothing untrusted reaches the actual page unsanitized. */
export function sanitize(html: string): string {
  if (!html) return '';
  if (!DOMPurify.isSupported) return html;
  ensureHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // data-* attributes are inert (they can't execute script); allowing them keeps the .ref-link
    // navigation dataset (data-ref-key/data-ref-id) that DescBody's click handler reads.
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    // ALLOWED_TAGS is already an exhaustive allowlist; FORBID_TAGS restates the highest-risk
    // embedding/scripting tags as a second line of defense. (No USE_PROFILES — it would re-widen
    // the tag set, e.g. re-permitting <img>.)
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'img', 'svg', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcset', 'src', 'formaction', 'xlink:href'],
  });
}
