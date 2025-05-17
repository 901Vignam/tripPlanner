'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Video {
  id: number;
  url: string;
  thumbnail: string;
  title: string;
  score?: number;
}

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideos, setSelectedVideos] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [itinerary, setItinerary] = useState('');

const handleSearch = async () => {
  setLoading(true);
  setError('');
  setVideos([]);
  setSelectedVideos(new Set());
  setItinerary('');

  try {
    // 🔹 1. Get relevant search queries from Gemini 1.5 Pro
    const queryGenRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You're an expert AI travel assistant. Based on the user's travel interest "${prompt}", return exactly 3 clean YouTube Shorts search phrases. Each should be a short keyword phrase (3–7 words), no markdown, no quotes, no numbers. Output only the phrases, one per line.`,
                },
              ],
            },
          ],
        }),
      }
    );

    const queryGenData = await queryGenRes.json();
    const queryText = queryGenData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const queries = queryText
      .split('\n')
      .map((line:any) => line.trim())
      .filter((line:any) => line.length > 2);

    // 🔹 2. Use Gemini to extract destination/place name from the prompt
    const locationRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `From this travel prompt: "${prompt}", extract the most likely destination or place (city, region, country). Only return the place name — no explanations.`,
                },
              ],
            },
          ],
        }),
      }
    );

    const locationData = await locationRes.json();
    const location =
      locationData.candidates?.[0]?.content?.parts?.[0]?.text.trim().toLowerCase() || '';
    console.log('📍 Extracted location:', location);

    // 🔹 3. Run 3 parallel YouTube search queries
    const searchResponses = await Promise.all(
      queries.map((query:any) =>
        fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(
            query
          )}&key=${process.env.NEXT_PUBLIC_YOUTUBE_API_KEY}`
        ).then((res) => res.json())
      )
    );

    let allVideoIds: string[] = [];
    for (const result of searchResponses) {
      const ids = (result.items || [])
        .filter((item: any) => item.id.kind === 'youtube#video' && item.id.videoId)
        .map((item: any) => item.id.videoId);
      allVideoIds.push(...ids);
    }

    // 🔹 4. Fallback if no valid videos found
    if (allVideoIds.length === 0) {
      const fallbackRes = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=Goa travel&key=${process.env.NEXT_PUBLIC_YOUTUBE_API_KEY}`
      );
      const fallbackData = await fallbackRes.json();
      allVideoIds = (fallbackData.items || [])
        .filter((item: any) => item.id.kind === 'youtube#video' && item.id.videoId)
        .map((item: any) => item.id.videoId);
    }

    const uniqueVideoIds = [...new Set(allVideoIds)];
    const videoChunks = [];
    for (let i = 0; i < uniqueVideoIds.length; i += 50) {
      videoChunks.push(uniqueVideoIds.slice(i, i + 50).join(','));
    }

    // 🔹 5. Get video details
    const detailResponses = await Promise.all(
      videoChunks.map((chunk) =>
        fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${chunk}&key=${process.env.NEXT_PUBLIC_YOUTUBE_API_KEY}`
        ).then((res) => res.json())
      )
    );

    const allDetails = detailResponses.flatMap((res) => res.items || []);

    // 🔹 6. Score and rank videos
    const scoredVideos = allDetails
      .map((item: any, index: number): Video | null => {
        const duration = item.contentDetails.duration;
        const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
        const minutes = parseInt(match?.[1] || '0');
        const seconds = parseInt(match?.[2] || '0');
        const totalSeconds = minutes * 60 + seconds;
        if (totalSeconds > 60) return null;

        const title = item.snippet.title || '';
        const description = item.snippet.description || '';
        const tags = item.snippet.tags || [];

        const stats = item.statistics || {};
        const views = parseInt(stats.viewCount || '0');
        const likes = parseInt(stats.likeCount || '0');
        const comments = parseInt(stats.commentCount || '0');

        const engagementScore =
          0.4 * (views / 1000) + 0.3 * likes + 0.3 * comments;

        const lowerPrompt = prompt.toLowerCase();
        const relevanceScore =
          (title.toLowerCase().includes(lowerPrompt) ? 10 : 0) +
          (description.toLowerCase().includes(lowerPrompt) ? 5 : 0) +
          tags.filter((t: string) =>
            lowerPrompt.includes(t.toLowerCase())
          ).length * 2;

        const qualityScore =
          (totalSeconds <= 60 ? 5 : 0) + (tags.length >= 3 ? 5 : 2);

        const locationMatched =
          location &&
          (
            title.toLowerCase() +
            description.toLowerCase() +
            tags.join(' ').toLowerCase()
          ).includes(location);

        const locationBoost = locationMatched ? 5 : 0;

        const finalScore =
          0.4 * relevanceScore +
          0.3 * engagementScore +
          0.3 * qualityScore +
          locationBoost;

        return {
          id: index,
          url: `https://www.youtube.com/watch?v=${item.id}`,
          thumbnail: item.snippet.thumbnails.high.url,
          title,
          score: finalScore,
        };
      })
      .filter((v): v is Video => v !== null)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 20);

    setVideos(scoredVideos);
  } catch (err) {
    console.error(err);
    setError('Something went wrong. Please check API keys or quota.');
  } finally {
    setLoading(false);
  }
};



  const toggleSelection = (id: number) => {
    const updated = new Set(selectedVideos);
    updated.has(id) ? updated.delete(id) : updated.add(id);
    setSelectedVideos(updated);
  };

const generateItinerary = async () => {
  const selected = videos.filter((v) => selectedVideos.has(v.id));
  if (selected.length === 0) return;

  setLoading(true);
  setError('');
  setItinerary('');

  try {
    // Optional: re-use extracted location from earlier and store it in state if needed
    const locationRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `From this travel prompt: "${prompt}", extract the most likely destination or city name. Return only the place name.`,
                },
              ],
            },
          ],
        }),
      }
    );

    const locationData = await locationRes.json();
    const location =
      locationData.candidates?.[0]?.content?.parts?.[0]?.text.trim() || '';

    const promptText = `You're a smart AI travel planner. Based on the destination "${location}" and the following YouTube Shorts, generate a 2-day travel itinerary.

Instructions:
- Break it down by Day 1 and Day 2
- Include "Morning", "Afternoon", "Evening" blocks
- Mention key places or neighborhoods near each other
- Suggest **estimated costs per activity or per day** (realistic, rough)
- Provide helpful **booking site suggestions** (like Airbnb Experiences, Viator, GetYourGuide, etc.)
- Format output clearly using markdown (headings, bullets, bold text)
- Focus only on experiences relevant to the video content
- Output should feel like a local guide summary

Use these YouTube Shorts as travel inspiration:
${selected.map((v, i) => `${i + 1}. ${v.title} - ${v.url}`).join('\n')}
`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
        }),
      }
    );

    const data = await geminiRes.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    setItinerary(result);
  } catch (err) {
    console.error(err);
    setError('Failed to generate itinerary.');
  } finally {
    setLoading(false);
  }
};



  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-6">Travel Shorts Finder 🧳</h1>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <input
          type="text"
          className="flex-1 px-4 py-2 border rounded shadow"
          placeholder="e.g. water sports in Goa"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          className="px-6 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700"
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? 'Searching...' : 'Find Shorts'}
        </button>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {videos.length === 0 && !loading && (
        <p className="text-center text-gray-500">No videos found. Try a different search.</p>
      )}

      {videos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {videos.map((video) => (
            <div
              key={video.id}
              onClick={() => toggleSelection(video.id)}
              className={`cursor-pointer bg-white rounded shadow overflow-hidden border-4 ${
                selectedVideos.has(video.id) ? 'border-green-500' : 'border-transparent'
              }`}
            >
              <a href={video.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="w-full h-48 object-cover"
                />
              </a>
              <div className="p-2 text-sm font-medium">{video.title}</div>
            </div>
          ))}
        </div>
      )}

      {selectedVideos.size > 0 && (
        <button
          onClick={generateItinerary}
          className="px-6 py-3 bg-green-600 text-white rounded shadow hover:bg-green-700"
        >
          {loading ? 'Generating Itinerary...' : 'Generate Itinerary ✈️'}
        </button>
      )}

      {loading && selectedVideos.size > 0 && (
        <p className="text-center text-gray-600 mt-4">🧠 Generating itinerary using AI...</p>
      )}

      {itinerary && (
        <div className="mt-10 p-6 bg-white rounded shadow">
          <h2 className="text-xl font-bold mb-4">AI-Generated Itinerary 📍</h2>
          <div className="prose max-w-none text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {itinerary}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </main>
  );
}
