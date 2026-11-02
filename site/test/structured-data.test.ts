import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { serializeJsonLd } from '../src/util/structured-data'

describe('JSON-LD serialization', () => {
  it('cannot terminate the containing script element', () => {
    const title = '</script><script id="injected"></script>'
    const serialized = serializeJsonLd({ title })
    const document = new JSDOM(`<script type="application/ld+json">${serialized}</script>`).window.document

    expect(serialized).not.toContain('</script>')
    expect(document.scripts).toHaveLength(1)
    expect(document.querySelector('#injected')).toBeNull()
    expect(JSON.parse(document.scripts[0]?.textContent ?? '{}')).toEqual({ title })
  })
})
