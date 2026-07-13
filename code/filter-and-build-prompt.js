const staticData = $getWorkflowStaticData('global');
const postedLinks = staticData.postedLinks || [];
const postedHeadlines = (staticData.postedHeadlines || []).map(h => (h || '').toLowerCase().trim());

const HOURS = 15; // window: covers overnight gap before the 9am run
const cutoff = Date.now() - HOURS * 60 * 60 * 1000;

const stories = $input.all()
  .filter(i => new Date(i.json.pubDate || i.json.isoDate || 0).getTime() > cutoff)
  // block anything whose article title matches a headline we've already posted
  .filter(i => {
    const title = (i.json.title || '').toLowerCase().trim();
    return title && !postedHeadlines.includes(title);
  })
  // secondary guard: block by exact link if it happens to match a stored link
  .filter(i => !postedLinks.includes(i.json.link))
  .map(i => ({
    title: i.json.title,
    snippet: (i.json.contentSnippet || i.json.content || '').replace(/<[^>]*>/g, '').slice(0, 300),
    link: i.json.link,
    source: (i.json.link || '').includes('techcrunch') ? 'TechCrunch'
          : (i.json.link || '').includes('theverge') ? 'The Verge'
          : 'Ars Technica'
  }));

if (stories.length === 0) {
  return [{ json: { stories: [], prompt: '', empty: true } }];
}

const avoid = (staticData.postedHeadlines || []).slice(-10).map(h => `- ${h}`).join('\n');

const prompt = `You are a tech news analyst. Below are recent tech headlines from TechCrunch, The Verge, and Ars Technica.

${JSON.stringify(stories, null, 2)}

ALREADY POSTED recently (do NOT pick these stories or the same news covered by another outlet):
${avoid || '- none'}

Tasks:
1. Pick the single most significant tech INNOVATION from the list (new product, breakthrough, launch - not opinion pieces, layoffs, or lawsuits). It must be a DIFFERENT story from the already-posted list above.
2. Legitimacy check: score 1-10. Score 8+ only if the story appears in 2 or more of the sources OR is from an official company announcement. Flag anything that smells like rumor or leak.
3. category: the single tech beat this falls under, ONE or TWO words, uppercase-friendly (e.g. AI, HARDWARE, SECURITY, ROBOTICS, SPACE).
4. Write an Instagram caption: hook line, 2-3 sentence summary in plain language, credit line 'Source: <outlet>', 5 relevant hashtags. Max 3 emojis.

Respond ONLY with raw JSON, no markdown fences:
{"category": "", "headline": "", "summary": "", "sources": [], "source_link": "", "legit_score": 0, "legit_reason": "", "ig_caption": ""}`;

return [{ json: { stories, prompt, empty: false } }];
