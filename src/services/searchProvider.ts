/* eslint-disable camelcase */

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilyResponse {
  answer?: string;
  query: string;
  results: TavilyResult[];
  response_time: number;
}

/**
 * Search the web using Tavily API.
 * https://docs.tavily.com/docs/welcome
 */
export async function searchWeb(
  query: string,
  apiKey: string,
): Promise<TavilyResponse> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: true,
      max_results: 5,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Tavily API error ${response.status}: ${errBody}`);
  }

  return response.json() as Promise<TavilyResponse>;
}

/**
 * Format Tavily search results as a readable text block for the LLM.
 */
export function formatSearchResults(res: TavilyResponse): string {
  const parts: string[] = [];

  if (res.answer) {
    parts.push(`[AI-generated answer]: ${res.answer}`);
    parts.push('');
  }

  parts.push(`Search results for "${res.query}":`);
  res.results.forEach((r, i) => {
    parts.push(`${i + 1}. **${r.title}**`);
    parts.push(`   URL: ${r.url}`);
    parts.push(`   ${r.content}`);
    parts.push('');
  });

  return parts.join('\n');
}
