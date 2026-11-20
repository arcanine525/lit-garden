import { serveSubmission } from '../../../../../server/drive/submission-http';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serveSubmission(id,undefined,new URL(request.url).searchParams.get('download') === '1');
}
