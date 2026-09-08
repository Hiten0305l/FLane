// services/geminiService.js
// Handles LLM order confirmation, structured order state tracking, dynamic phrasing variation, and interruption recovery.

import { findMenuItem, getCanonicalItemName, MENU_CATALOG } from './menuCatalog.js';

const PRIMARY_MODEL = 'gemini-flash-lite-latest';

const SYSTEM_INSTRUCTION = `You are FastLane, an ultra-fast, friendly, and natural English-speaking drive-thru order-taking assistant.

Primary Directives:
1. Language: English ONLY for all spoken responses. Do NOT generate Hinglish, Hindi, Devanagari, or any other language under any circumstance.
2. Persona: Sound like a real person taking an order — energetic, professional, friendly, and natural. Not a robotic script.
3. Length: Exactly 1 to 2 short sentences. Conversational, concise, and optimized for ultra-low latency voice synthesis.
4. Currency: All prices are in Indian Rupees (₹ / INR). Never mention or output dollars ($).

Phrasing & Dynamic Variation Guidelines:
- Vary your phrasing naturally across turns — do not reuse the exact same sentence structure or stock phrases repeatedly. Sound like a real person taking an order, not a script.
- Do NOT always phrase confirmations the same way (avoid always starting with "Got it —" or always ending with "Anything else?" verbatim every single turn). Freely vary your sentence structure and word choice turn to turn while keeping it brief.
- After an interruption specifically: the reply should acknowledge the customer's correction naturally (for example: "One large Margherita, coming up!", "Sounds good — large Margherita it is.", "Sure thing, switching that to a Margherita for you.") rather than a generic, repeated phrase.
- Never use random filler, preamble, or off-topic chatter.
- Never upsell or mention unrequested menu items.

Substitutions & Replacement Directives:
- If the customer asks to replace, swap, switch, or substitute an item (e.g. "replace the fries with nuggets", "change fries to burger", "substitute fries for dessert"):
  * Replace ONLY the specified item in the order.
  * All other existing items in currentOrderState MUST remain intact and untouched (e.g. if order was ["Double Smash Burger", "Crispy Fries"] and customer says "replace the fries with nuggets", the new items array is strictly ["Double Smash Burger", "Chicken Nuggets"]).
  * Never clear or remove unmentioned items.
  * Acknowledge the exact substitution naturally in 1 short spoken sentence.

- If this turn is an INTERRUPTION (isInterruption: true):
  * The customer interrupted mid-speech with a correction, substitution, addition, or cancellation.
  * Carefully parse customerUtterance and apply the exact change requested.
  * Discard whatever incomplete suggestions or options you were previously offering.
  * Merge the correction with previously confirmed attributes from currentOrderState.
  * For example, if currentOrderState had ["Double Smash Burger", "Crispy Fries"] and customer interrupts with "make that a Sprite and add garlic bread", the items array becomes ["Double Smash Burger", "Crispy Fries", "Sprite", "Garlic Bread"].
  * Acknowledge their specific correction directly and naturally.

Output Format:
You MUST output your response strictly in two parts:
<Spoken English reply to customer (1-2 short sentences)>
ORDER_STATE: {"items": ["item1", ...], "confirmed": boolean}
`;

export async function generateFullReply({
  text,
  orderState = { items: [], confirmed: false },
  isInterruption = false,
  apiKey = process.env.GEMINI_API_KEY
}) {
  if (!apiKey) {
    return getFallbackReply({ text, orderState, isInterruption });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_MODEL}:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        parts: [{
          text: JSON.stringify({
            customerUtterance: text,
            currentOrderState: orderState,
            isInterruption
          })
        }]
      }
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    generationConfig: {
      maxOutputTokens: 140,
      temperature: 0.85
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
    console.warn(`[Gemini API] Network error (${err.message}). Using fallback generator.`);
    return getFallbackReply({ text, orderState, isInterruption });
  }

  if (!res.ok) {
    console.warn(`[Gemini API] Status ${res.status}: using fallback generator.`);
    return getFallbackReply({ text, orderState, isInterruption });
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseReplyAndOrderState(rawText, { text, orderState, isInterruption });
}

export async function streamReply({
  text,
  orderState = { items: [], confirmed: false },
  isInterruption = false,
  onToken,
  apiKey = process.env.GEMINI_API_KEY
}) {
  if (!apiKey) {
    return streamFallbackReply({ text, orderState, isInterruption, onToken });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_MODEL}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const payload = {
    contents: [
      {
        parts: [{
          text: JSON.stringify({
            customerUtterance: text,
            currentOrderState: orderState,
            isInterruption
          })
        }]
      }
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    generationConfig: {
      maxOutputTokens: 140,
      temperature: 0.85
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
    console.warn(`[Gemini Stream] Network error (${err.message}). Using fallback stream.`);
    return streamFallbackReply({ text, orderState, isInterruption, onToken });
  }

  if (!res.ok) {
    console.warn(`[Gemini Stream] Status ${res.status}: using fallback stream.`);
    return streamFallbackReply({ text, orderState, isInterruption, onToken });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let rawAccumulator = '';
  let sseBuffer = '';
  let spokenEmittedLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(jsonStr);
        const token = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (token) {
          rawAccumulator += token;

          // Determine spoken text available before ORDER_STATE:
          const markerIdx = rawAccumulator.indexOf('ORDER_STATE:');
          let spokenTextAvailable = markerIdx !== -1 ? rawAccumulator.slice(0, markerIdx) : rawAccumulator;

          // If ORDER_STATE: marker hasn't appeared yet, avoid emitting partial "ORDER_STATE:" prefix
          if (markerIdx === -1) {
            const match = spokenTextAvailable.match(/\n*O(R(D(E(R(_(S(T(A(T(E(:)?)?)?)?)?)?)?)?)?)?)?$/);
            if (match) {
              spokenTextAvailable = spokenTextAvailable.slice(0, match.index);
            }
          }

          if (spokenTextAvailable.length > spokenEmittedLength) {
            const newChunk = spokenTextAvailable.slice(spokenEmittedLength);
            spokenEmittedLength = spokenTextAvailable.length;
            if (newChunk) {
              onToken(newChunk);
            }
          }
        }
      } catch (err) {
        // Skip malformed SSE lines
      }
    }
  }

  const parsedResult = parseReplyAndOrderState(rawAccumulator, { text, orderState, isInterruption });
  const cleanSpoken = parsedResult.reply;
  if (cleanSpoken.length > spokenEmittedLength) {
    const remaining = cleanSpoken.slice(spokenEmittedLength);
    if (remaining) {
      onToken(remaining);
    }
  }

  return parsedResult;
}

function parseReplyAndOrderState(rawText, fallbackContext) {
  if (!rawText || !rawText.trim()) {
    return getFallbackReply(fallbackContext);
  }

  const parts = rawText.split(/ORDER_STATE:\s*/i);
  const spokenReply = (parts[0] || '').trim();

  let updatedOrderState = fallbackContext.orderState;
  if (parts[1]) {
    try {
      const jsonStr = parts[1].trim().replace(/^```json/i, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed && Array.isArray(parsed.items)) {
        updatedOrderState = {
          items: parsed.items,
          confirmed: Boolean(parsed.confirmed)
        };
      }
    } catch (e) {
      console.warn('[Gemini Parser] Could not parse ORDER_STATE JSON, using heuristics:', e.message);
      updatedOrderState = updateOrderStateHeuristic(fallbackContext.orderState, fallbackContext.text, fallbackContext.isInterruption);
    }
  } else {
    updatedOrderState = updateOrderStateHeuristic(fallbackContext.orderState, fallbackContext.text, fallbackContext.isInterruption);
  }

  return {
    reply: spokenReply || "I've got that updated for you. Anything else?",
    orderState: updatedOrderState
  };
}

// Fallback heuristic state updater ensuring structured state is always maintained
function updateOrderStateHeuristic(currentOrderState, userText, isInterruption) {
  let items = [...(currentOrderState?.items || [])];
  const lower = userText.toLowerCase().trim();

  // 1. Explicit Replacement / Substitution handling:
  // e.g. "replace the fries with nuggets", "substitute the fries for a burger", "change fries to nuggets", "swap the fries with nuggets", "instead of fries, give me nuggets"
  const replaceMatch = lower.match(/(?:replace|substitute|switch|change|swap)\s+(?:the\s+)?(.+?)\s+(?:with|for|to)\s+(?:a\s+|an\s+|the\s+)?(.+)/i)
    || lower.match(/instead of\s+(?:the\s+)?(.+?)(?:,\s*|\s+)(?:give me|get me|i'll have|i want|make it|make that)?\s*(?:a\s+|an\s+|the\s+)?(.+)/i);

  if (replaceMatch) {
    const oldQuery = replaceMatch[1].trim().replace(/\b(please|thanks)\b/gi, '').trim();
    const newQuery = replaceMatch[2].trim().replace(/[.,!?;]+$/, '').replace(/\b(please|thanks)\b/gi, '').trim();

    const oldItemCanonical = findMenuItem(oldQuery);
    const newItemCanonical = findMenuItem(newQuery);

    const oldName = oldItemCanonical ? oldItemCanonical.name : oldQuery;
    const newName = newItemCanonical ? newItemCanonical.name : newQuery;

    // Find the item to replace in current order
    let targetIdx = -1;
    if (oldItemCanonical) {
      targetIdx = items.findIndex(it => {
        const itLower = it.toLowerCase();
        return itLower === oldItemCanonical.name.toLowerCase() ||
               oldItemCanonical.aliases.some(al => itLower.includes(al.toLowerCase()));
      });
    }
    if (targetIdx === -1) {
      targetIdx = items.findIndex(it => it.toLowerCase().includes(oldQuery.toLowerCase()));
    }

    if (targetIdx !== -1) {
      // Replace ONLY that item!
      items[targetIdx] = newName;
    } else {
      // If old item not found in order, add new item
      items.push(newName);
    }

    return { items, confirmed: false, replacedOld: oldName, replacedNew: newName };
  }

  // 2. Cancellations / Removals
  if (lower.startsWith('no ') || lower.includes('cancel ') || lower.includes('remove ') || lower.includes('without ')) {
    const target = lower.replace(/^(no|cancel|remove|without)\s+/i, '').replace(/\b(please|thanks|the)\b/gi, '').trim();
    if (target) {
      const match = findMenuItem(target);
      if (match) {
        items = items.filter(it => !match.aliases.some(al => it.toLowerCase().includes(al)));
      } else {
        items = items.filter(it => !it.toLowerCase().includes(target));
      }
    }
    return { items, confirmed: false };
  }

  // 3. Centralized menu item additions / substitutions
  const matchedItem = findMenuItem(lower);
  if (matchedItem) {
    const canonicalName = matchedItem.name;
    // If it's a direct item request, check if we should substitute in interruption mode
    if (isInterruption) {
      // If user is interrupting with a new item of same category (e.g., drinks or pizzas)
      const sameCatIdx = items.findIndex(it => {
        const existing = findMenuItem(it);
        return existing && existing.category === matchedItem.category;
      });
      if (sameCatIdx !== -1) {
        items[sameCatIdx] = canonicalName;
        return { items, confirmed: false };
      }
    }

    if (!items.some(it => it.toLowerCase().includes(matchedItem.id) || it.toLowerCase() === canonicalName.toLowerCase())) {
      items.push(canonicalName);
    }
    return { items, confirmed: false };
  }

  // 4. Generic cleaned description fallback
  const clean = userText.replace(/^(can i get|i'd like|i will have|i'll have|give me|please get me|make that a|switch that to|change that to|just give me|actually|wait|no|add)\s+/i, '').trim();
  if (clean && clean.length > 2 && !items.includes(clean) && !/^(yes|no|ok|okay|wait|stop)$/i.test(clean)) {
    const canonical = getCanonicalItemName(clean);
    items.push(canonical);
  }

  return { items, confirmed: false };
}

export function getFallbackReply({ text, orderState = { items: [] }, isInterruption = false }) {
  const updatedState = updateOrderStateHeuristic(orderState, text, isInterruption);
  const itemsDesc = updatedState.items.join(' and ') || 'your order';

  if (updatedState.replacedOld && updatedState.replacedNew) {
    const reply = `Got it! I've replaced the ${updatedState.replacedOld} with ${updatedState.replacedNew} for you. Anything else?`;
    return { reply, orderState: { items: updatedState.items, confirmed: updatedState.confirmed } };
  }

  if (isInterruption) {
    const interruptVariations = [
      `Sure thing, I've updated your order to ${itemsDesc}. Anything else?`,
      `Got it, switching that right over. Now we have ${itemsDesc}. What else can I get you?`,
      `Understood, adjusted that to ${itemsDesc}. Anything more today?`,
      `No problem at all — changed to ${itemsDesc}. Can I get you anything else?`
    ];
    const reply = interruptVariations[Math.floor(Math.random() * interruptVariations.length)];
    return { reply, orderState: { items: updatedState.items, confirmed: updatedState.confirmed } };
  }

  const normalVariations = [
    `Perfect, I've added ${itemsDesc}. Would you like anything else?`,
    `Got it — that's ${itemsDesc}. Anything more for you?`,
    `Sure, I've got ${itemsDesc} down. Can I get you anything to drink?`,
    `All right, that's ${itemsDesc}. Is there anything else I can get started?`,
    `Right away, one ${itemsDesc} coming up!`
  ];
  const reply = normalVariations[Math.floor(Math.random() * normalVariations.length)];
  return { reply, orderState: { items: updatedState.items, confirmed: updatedState.confirmed } };
}

export async function streamFallbackReply({ text, orderState, isInterruption, onToken }) {
  const { reply, orderState: updatedState } = getFallbackReply({ text, orderState, isInterruption });
  const words = reply.split(' ');

  for (let i = 0; i < words.length; i++) {
    const wordWithSpace = (i === 0 ? '' : ' ') + words[i];
    onToken(wordWithSpace);
    await new Promise(r => setTimeout(r, 25));
  }

  return { reply, orderState: updatedState };
}
