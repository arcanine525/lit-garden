import { serveSubmission } from '../../../../../server/drive/submission-http';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return serveSubmission(id);
}
