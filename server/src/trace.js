// Rule 14: a W3C trace-context envelope on every arrow. One trace id for the whole walkthrough, one span id per arrow, and each arrow's
// parent is the arrow before it. The ids are derived from the vertical, so they are the same on every run (a teaching value, not a real trace).
import crypto from 'node:crypto';

export const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-01$/;
const hex = (seed, len) => {
  const h = crypto.createHash('sha256').update(seed).digest('hex').slice(0, len);
  return /^0+$/.test(h) ? `1${h.slice(1)}` : h;
};

// edges: the diagram's arrows (source, target, dashed = a response); messages: what each arrow says; payloads: the text under it (or null).
export function buildTrace({ edges, messages, payloads, seed }) {
  const traceId = hex(`${seed}:trace`, 32);
  return edges.map((e, i) => {
    const spanId = hex(`${seed}:span:${i}`, 16);
    const parentSpanId = i === 0 ? null : hex(`${seed}:span:${i - 1}`, 16);
    const kind = e.dashed ? 'response' : 'request';
    const traceparent = `00-${traceId}-${spanId}-01`;
    return {
      index: i, kind, message: messages[i], from: e.source, to: e.target, traceId, spanId, parentSpanId, traceparent,
      raw: [`${kind === 'request' ? 'REQUEST' : 'RESPONSE'} ${e.source.toUpperCase()} -> ${e.target.toUpperCase()}`, `traceparent: ${traceparent}`, '', payloads[i] ?? messages[i]].join('\n'),
    };
  });
}
