import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get('videoId');

  if (!videoId) {
    return NextResponse.json({ transcript: null }, { status: 400 });
  }

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const fullText = transcript.map((t) => t.text).join(' ');
    return NextResponse.json({ transcript: fullText });
  } catch (e) {
    console.error('Transcript fetch failed:', e);
    return NextResponse.json({ transcript: null });
  }
}