/* eslint-disable */

'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateItineraryFromVideos } from './utils/generateItinerary';

interface Video {
  id: number;
  url: string;
  title: string;
  thumbnail: string;
  description?: string;
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
      const geminiQueryRes = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${"AIzaSyC0vJOYNP-UL_9mdG8E8vaPDvd1EfFalYU"}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Give 3 specific YouTube Shorts search phrases based on the travel prompt: "${prompt}". Return them as a list.`,
                  },
                ],
              },
            ],
          }),
        }
      );

      const geminiData = await geminiQueryRes.json();
      const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const queries = raw.split('\n').map((line:any) => line.replace(/^\-/, '').trim()).filter(Boolean);

      let allVideoIds: string[] = [];

      const searchResponses = await Promise.all(
        queries.map((query:any) =>
          fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(
              query
            )}&key=${"AIzaSyAsvBONMGaRs5FuXQUDMeJjvK34l8Ca-dc"}`
          ).then((res) => res.json())
        )
      );

      for (const res of searchResponses) {
        const ids = (res.items || [])
          .filter((item: any) => item.id.kind === 'youtube#video' && item.id.videoId)
          .map((item: any) => item.id.videoId);
        allVideoIds.push(...ids);
      }

      allVideoIds = Array.from(new Set(allVideoIds)).slice(0, 50);
      const chunk = allVideoIds.join(',');

      const detailsRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${chunk}&key=${"AIzaSyAsvBONMGaRs5FuXQUDMeJjvK34l8Ca-dc"}`
      );
      const detailData = await detailsRes.json();

      const scoredVideos = detailData.items
        .map((item: any, index: number): Video | null => {
          const title = item.snippet.title || '';
          const description = item.snippet.description || '';
          const duration = item.contentDetails.duration;

          const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
          const minutes = parseInt(match?.[1] || '0');
          const seconds = parseInt(match?.[2] || '0');
          const totalSeconds = minutes * 60 + seconds;
          if (totalSeconds > 60) return null;

          const views = parseInt(item.statistics.viewCount || '0');
          const likes = parseInt(item.statistics.likeCount || '0');
          const comments = parseInt(item.statistics.commentCount || '0');

          const engagementScore = 0.4 * (views / 1000) + 0.3 * likes + 0.3 * comments;
          const relevanceScore =
            (title.toLowerCase().includes(prompt.toLowerCase()) ? 10 : 0) +
            (description.toLowerCase().includes(prompt.toLowerCase()) ? 5 : 0);
          const qualityScore = 5;

          const score = 0.4 * relevanceScore + 0.3 * engagementScore + 0.3 * qualityScore;

          return {
            id: index,
            url: `https://www.youtube.com/watch?v=${item.id}`,
            title,
            thumbnail: item.snippet.thumbnails?.high?.url,
            description,
            score,
          };
        })
        .filter((v:any): v is Video => v !== null)
        .sort((a:any, b:any) => (b.score || 0) - (a.score || 0))
        .slice(0, 20);

      setVideos(scoredVideos);
    } catch (err) {
      console.error(err);
      setError('Search failed. Check API keys.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateItinerary = async () => {
    const selected = videos.filter((v) => selectedVideos.has(v.id));
    if (selected.length === 0) return;

    setLoading(true);
    setError('');
    setItinerary('');

    try {
      const result = await generateItineraryFromVideos(
        prompt,
        selected.map((v) => ({
          title: v.title,
          url: v.url,
          description: v.description,
          thumbnailUrl: v.thumbnail, // ✅ This is the fix
        }))
      );
      setItinerary(result);
    } catch (e) {
      console.error(e);
      setError('Itinerary generation failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: number) => {
    const updated = new Set(selectedVideos);
    updated.has(id) ? updated.delete(id) : updated.add(id);
    setSelectedVideos(updated);
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-800">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-bold mb-4 text-center">
          🌍 Travel Shorts Explorer
        </h1>
        <p className="text-center mb-8 text-gray-600">
          Discover experiences from YouTube Shorts and build your dream itinerary.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <input
            className="flex-1 border border-gray-300 px-4 py-2 rounded shadow-sm focus:outline-none focus:ring focus:ring-blue-300"
            placeholder="e.g. Water sports in Goa"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded shadow hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Search Shorts'}
          </button>
        </div>

        {error && <p className="text-red-500 mb-4 text-center">{error}</p>}

        {videos.length > 0 && (
          <section>
            <h2 className="text-2xl font-semibold mb-4">🎬 Reels Found</h2>
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 mb-8">
              {videos.map((video) => (
                <div
                  key={video.id}
                  onClick={() => toggleSelection(video.id)}
                  className={`rounded overflow-hidden shadow hover:shadow-lg transition cursor-pointer border-2 ${
                    selectedVideos.has(video.id)
                      ? 'border-green-500'
                      : 'border-transparent'
                  }`}
                >
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-3">
                    <p className="font-medium text-sm text-gray-800">{video.title}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {selectedVideos.size > 0 && (
          <div className="text-center mb-10">
            <button
              onClick={handleGenerateItinerary}
              className="bg-green-600 text-white px-8 py-3 rounded shadow hover:bg-green-700 transition"
            >
              {loading ? 'Generating Itinerary…' : '🧭 Generate Itinerary'}
            </button>
          </div>
        )}

        {loading && selectedVideos.size > 0 && (
          <p className="text-center text-gray-600">🧠 Working on your itinerary…</p>
        )}

        {itinerary && (
          <section>
            <h2 className="text-2xl font-semibold mb-4">📌 Your AI-Powered Itinerary</h2>
            <div className="bg-white p-6 rounded-lg shadow prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{itinerary}</ReactMarkdown>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
