import { serveSubmission } from '../../../../../../../server/drive/submission-http';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; asset: string }> }) {
  const { id, asset } = await params;
  return serveSubmission(id,asset);
}
