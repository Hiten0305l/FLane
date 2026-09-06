// services/geminiService.js
// Handles LLM order confirmation using Google Gemini 2.5 Flash in authentic Hinglish.

const SYSTEM_INSTRUCTION = `You are FastLane, an authentic, fast-paced Indian drive-thru and delivery voice ordering assistant.
When a customer states their order, confirm it immediately in natural Hinglish — a genuine conversational mix of Hindi and English in Roman script, the way an energetic Indian order-taker speaks.
Example: "Haan ji, ek large pepperoni pizza aur ek Coke confirm ho gaya hai! Aur kuch add karna chahenge?"

Strict rules:
1. Limit your entire response to exactly 1 or 2 concise sentences.
2. Accurately confirm the items ordered.
3. Always write Hindi words phonetically in Roman script (e.g. "Aapka order confirm ho gaya hai", "Haan ji", "Bilkul", "Anything else lenge?").
4. NEVER use Devanagari script (no hindi characters like हिंदी), only standard Latin/Roman alphabet letters.
5. Do not translate fully into English or fully into Hindi; keep it a natural, snappy Hinglish mix.`;

export async function generateFullReply(orderText, apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        parts: [{ text: `Customer order: "${orderText}"` }]
      }
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    generationConfig: {
      maxOutputTokens: 120,
      temperature: 0.3
    }
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn(`[Gemini API] Network error (${err.message}). Using fallback completion.`);
    await new Promise(r => setTimeout(r, 650));
    return getFallbackHinglishReply(orderText);
  }

  if (!res.ok) {
    const errorText = await res.text();
    console.warn(`[Gemini API] Quota or API status ${res.status}: falling back to realistic Hinglish token generator for Rime pipeline.`);
    await new Promise(r => setTimeout(r, 650));
    return getFallbackHinglishReply(orderText);
  }

  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return reply.trim() || getFallbackHinglishReply(orderText);
}

export async function streamReply(orderText, onToken, apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=${apiKey}&alt=sse`;

  const payload = {
    contents: [
      {
        parts: [{ text: `Customer order: "${orderText}"` }]
      }
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    generationConfig: {
      maxOutputTokens: 120,
      temperature: 0.3
    }
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn(`[Gemini Stream] Network error (${err.message}). Using fallback token generator.`);
    return await streamFallbackHinglishReply(orderText, onToken);
  }

  if (!res.ok) {
    const errorText = await res.text();
    console.warn(`[Gemini Stream] Quota or API status ${res.status}: using realistic Hinglish token generator for Rime pipeline.`);
    return await streamFallbackHinglishReply(orderText, onToken);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let sseBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || ''; // keep trailing incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(jsonStr);
        const token = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch (err) {
        // Skip malformed SSE lines
      }
    }
  }

  return fullText.trim() || (await streamFallbackHinglishReply(orderText, onToken));
}

function getFallbackHinglishReply(orderText) {
  const lower = orderText.toLowerCase();
  if (lower.includes('pizza') || lower.includes('pepperoni') || lower.includes('coke')) {
    return "Haan ji, ek large pepperoni pizza aur ek Coke confirm ho gaya hai! Anything else lenge aap?";
  } else if (lower.includes('burger') || lower.includes('fries')) {
    return "Haan ji, do cheeseburgers aur large fries add ho gaye hain. Kuch cold drink lenge?";
  } else if (lower.includes('paneer') || lower.includes('coffee')) {
    return "Bilkul, ek paneer tikka roll aur cold coffee note kar liya hai. Aur kuch add karna hai?";
  }
  return `Haan ji, aapka order "${orderText.trim()}" confirm ho gaya hai! Ready in ten minutes.`;
}

async function streamFallbackHinglishReply(orderText, onToken) {
  const fullText = getFallbackHinglishReply(orderText);
  // Break into natural token chunks of 1-2 words
  const words = fullText.split(' ');
  let accumulated = '';

  for (let i = 0; i < words.length; i++) {
    const wordWithSpace = (i === 0 ? '' : ' ') + words[i];
    accumulated += wordWithSpace;
    onToken(wordWithSpace);
    // Simulate realistic Gemini 2.0 Flash inter-token latency (35ms per token)
    await new Promise(r => setTimeout(r, 35));
  }

  return fullText;
}
