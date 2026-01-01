
const { GoogleGenAI, Type } = require("@google/genai");
const Parser = require("rss-parser");

const CONFIG = {
  GEMINI_KEY: process.env.GEMINI_API_KEY,
  INSTA_PAGE_ID: process.env.INSTA_PAGE_ID,
  INSTA_TOKEN: process.env.INSTA_ACCESS_TOKEN,
  IMGBB_KEY: process.env.IMGBB_API_KEY,
  TONE: "Hyped & Energetic",
  // Professional fallback image if AI generation is blocked by quota
  FALLBACK_IMAGE: "https://images.unsplash.com/photo-1677442136019-21780ecad995?q=80&w=1000&auto=format&fit=crop" 
};

const parser = new Parser();
const ai = new GoogleGenAI({ apiKey: CONFIG.GEMINI_KEY });

async function run() {
  console.log("-----------------------------------------");
  console.log("🚀 STARTING RESILIENT AI BOT");
  console.log("-----------------------------------------");

  // 1. FETCH NEWS (Text usually works on Free Tier)
  console.log("[1/4] 📡 Fetching News...");
  const sources = ["https://techcrunch.com/category/artificial-intelligence/feed/"];
  let allItems = [];
  try {
    const feed = await parser.parseURL(sources[0]);
    allItems = feed.items.slice(0, 3);
  } catch (e) {
    throw new Error("Could not fetch RSS feed.");
  }

  // 2. GENERATE TEXT (Gemini 3 Flash Free Tier is stable)
  console.log("[2/4] 🤖 Generating Viral Text...");
  const contentResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Create a hyped Instagram post summary for: ${JSON.stringify(allItems.map(i => i.title))}. Tone: ${CONFIG.TONE}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          caption: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["caption", "hashtags"]
      }
    }
  });
  const postData = JSON.parse(contentResponse.text);

  // 3. IMAGE LOGIC (The "Fallback Hack")
  console.log("[3/4] 🎨 Attempting AI Image Generation...");
  let finalImageUrl = CONFIG.FALLBACK_IMAGE;
  
  try {
    const imageResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: "Futuristic abstract tech background, neon blues and purples, 8k" }] },
      config: { imageConfig: { aspectRatio: "1:1" } }
    });
    
    const imgPart = imageResponse.candidates[0].content.parts.find(p => p.inlineData);
    if (imgPart) {
      console.log("   ✅ AI Image Generated! Uploading to ImgBB...");
      const formData = new URLSearchParams();
      formData.append("image", imgPart.inlineData.data);
      const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_KEY}`, {
        method: "POST",
        body: formData
      });
      const imgbbJson = await imgbbRes.json();
      finalImageUrl = imgbbJson.data.url;
    }
  } catch (err) {
    if (err.message.includes("429") || err.message.includes("quota")) {
      console.warn("   ⚠️ QUOTA EXCEEDED (429). Switching to Professional Fallback Image...");
      console.warn("   💡 Tip: Enable billing at ai.google.dev/gemini-api/docs/billing to unlock AI images.");
      // finalImageUrl remains the Unsplash fallback defined in CONFIG
    } else {
      console.error("   ❌ Unexpected Image Error:", err.message);
    }
  }

  // 4. POST TO INSTAGRAM
  console.log("[4/4] 📱 Publishing to Instagram...");
  console.log("   🔗 Using Image: " + finalImageUrl);
  
  const containerRes = await fetch(`https://graph.facebook.com/v20.0/${CONFIG.INSTA_PAGE_ID}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: finalImageUrl,
      caption: postData.caption + "\n\n" + postData.hashtags.map(h => "#"+h).join(" "),
      access_token: CONFIG.INSTA_TOKEN
    })
  });
  
  const container = await containerRes.json();
  if (container.error) throw new Error("Meta Error: " + container.error.message);

  const publishRes = await fetch(`https://graph.facebook.com/v20.0/${CONFIG.INSTA_PAGE_ID}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: CONFIG.INSTA_TOKEN })
  });

  console.log("-----------------------------------------");
  console.log("✅ DONE! Post successfully pushed to IG.");
  console.log("-----------------------------------------");
}

run().catch(err => {
  console.error("\n🚨 FATAL ERROR: " + err.message);
  process.exit(1);
});
