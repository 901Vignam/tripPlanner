// app/utils/generateItinerary.ts

interface VideoInput {
  title: string;
  url: string;
  description?: string;
  tags?: string[];
  thumbnailUrl: string;
}

export async function generateItineraryFromVideos(
  prompt: string,
  videos: VideoInput[]
): Promise<string> {
  try {
    // Step 1: Extract location from prompt
    const locationRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `From this travel prompt: "${prompt}", extract the most likely destination or place name only.`,
                },
              ],
            },
          ],
        }),
      }
    );

    const locationData = await locationRes.json();
    const location =
      locationData.candidates?.[0]?.content?.parts?.[0]?.text.trim() ||
      "your destination";

    // Step 2: Process each video with metadata + transcript + thumbnail
    const videoBlocks = await Promise.all(
      videos.map(async (video, i) => {
        const videoId = extractVideoId(video.url);
        const transcript = await fetchTranscript(videoId);
        const thumbnailBase64 = await fetchThumbnailAsBase64(
          video.thumbnailUrl
        );

        return {
          content: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: thumbnailBase64,
              },
            },
            {
              text: `Video ${i + 1} metadata:
- Title: ${video.title}
- Description: ${video.description || "No description"}
- Tags: ${video.tags?.join(", ") || "None"}
- Transcript: ${transcript || "Transcript not available"}
- Link: ${video.url}`,
            },
          ],
        };
      })
    );

    // Step 3: Ask Gemini to generate the itinerary using all video blocks
const allParts = [
  {
    text: `You're an AI travel planner. The user wants a detailed 2-day itinerary in ${location}. 
Use the following YouTube Shorts (with thumbnails, captions, and metadata) to infer:

- Main activities
- Type of travel (adventure, culture, chill, food, etc.)
- Neighborhoods or regions shown
- Cost estimates
- Suggested groupings by time of day
- Booking recommendations

**Format:**
- Use markdown
- Day 1 / Day 2
- Morning / Afternoon / Evening
- Approximate cost
- Booking suggestions (Airbnb Experiences, Viator, etc.)

Use real content only. Do not hallucinate or guess.

Videos:`
  },
  ...videoBlocks.flatMap((video) => video.content),
];

const geminiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${"AIzaSyAsvBONMGaRs5FuXQUDMeJjvK34l8Ca-dc"}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: allParts, // text-only: title, description, tags, captions
        },
      ],
    }),
  }
);



    const aiData = await geminiRes.json();
    return (
      aiData.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No itinerary generated."
    );
  } catch (error) {
    console.error("❌ Gemini itinerary error:", error);
    return "Itinerary generation failed.";
  }
}

// 🔧 Extract video ID from YouTube URL
function extractVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

// 🔧 Fetch transcript via your /api/captions route
async function fetchTranscript(videoId: string | null): Promise<string | null> {
  if (!videoId) return null;
  try {
    const res = await fetch(`/api/captions?videoId=${videoId}`);
    const data = await res.json();
    return data.transcript || null;
  } catch {
    return null;
  }
}

// 🔧 Convert thumbnail image to base64
async function fetchThumbnailAsBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return base64;
  } catch (e) {
    console.error("❌ Failed to fetch/convert thumbnail:", e);
    return "";
  }
}
