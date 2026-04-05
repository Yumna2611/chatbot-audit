// Vercel Serverless Function — /api/analyze
// Your Anthropic API key lives ONLY here as an environment variable.
// The frontend never sees it.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic rate limiting via Vercel's edge — 1 request per second per IP
  // For stronger limits, add Upstash Redis (free tier, 10k requests/day)
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  console.log(`Audit request from IP: ${ip}`);

  const { transcript } = req.body;

  if (!transcript || transcript.trim().length < 30) {
    return res.status(400).json({ error: 'Please provide a valid conversation transcript.' });
  }

  if (transcript.length > 8000) {
    return res.status(400).json({ error: 'Transcript too long. Please keep it under 8000 characters.' });
  }

  const prompt = `You are a senior Product Manager specializing in conversational banking at a top Indian private bank. Analyze this WhatsApp/chatbot banking conversation and produce a structured PM audit.

CONVERSATION:
${transcript}

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation, just JSON):
{
  "intent_detected": "string - what the customer actually wanted",
  "bot_quality_score": number between 1-10,
  "containment_result": "contained" | "escalated" | "abandoned",
  "containment_confidence": "high" | "medium" | "low",
  "kpi_impact": "string - which KPI this most affects",
  "findings": [
    {
      "severity": "critical" | "medium" | "positive",
      "title": "string - short finding title",
      "description": "string - 1-2 sentence explanation"
    }
  ],
  "recommendations": [
    {
      "action": "string - specific recommended fix",
      "kpi": "string - KPI this improves",
      "effort": "low" | "medium" | "high"
    }
  ],
  "pm_summary": "string - 2 sentence executive summary of the flow quality"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,  // ← lives in Vercel env vars, never exposed
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await response.json();
    const rawText = data.content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.error('JSON parse error:', rawText);
      return res.status(500).json({ error: 'Could not parse AI response. Please try again.' });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}
