/**
 * Shared JSON-LD structured data schemas for SEO.
 * Used by Head.astro (docs, blog, and changelog pages).
 */

/**
 * Serialize JSON-LD for insertion into a script element with `set:html`.
 *
 * JSON.stringify does not escape `<`, so a string containing `</script>` can
 * terminate the element before the browser parses the JSON. Escaping `<` as a
 * JSON Unicode sequence preserves the parsed value without creating HTML.
 */
export function serializeJsonLd(value: object): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function baseSchemas(siteUrl: string) {
  return [
    {
      '@type': 'Organization',
      name: 'Strands Agents',
      url: siteUrl,
      logo: siteUrl + '/favicon.svg',
      sameAs: ['https://github.com/strands-agents'],
      parentOrganization: {
        '@type': 'Organization',
        name: 'Amazon Web Services',
        url: 'https://aws.amazon.com',
      },
    },
    // No potentialAction/SearchAction: site search is Pagefind, a client-side
    // modal with no query-parameter URL — a SearchAction target would be fake.
    {
      '@type': 'WebSite',
      name: 'Strands Agents',
      url: siteUrl,
      publisher: { '@type': 'Organization', name: 'Strands Agents', url: siteUrl },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Strands Agents SDK',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Cross-platform',
      programmingLanguage: ['Python', 'TypeScript'],
      license: 'https://github.com/strands-agents/harness-sdk/blob/main/LICENSE.APACHE',
      url: siteUrl,
      author: { '@type': 'Organization', name: 'Strands Agents' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ]
}
