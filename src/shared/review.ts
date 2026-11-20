import type { RubricSnapshot } from '../server/assignments/bundle';

export const reviewColors = { yellow:'Vàng',green:'Xanh lá',pink:'Hồng',blue:'Xanh lam' } as const;
export type ReviewColor = keyof typeof reviewColors;
export type Anchor = { start: number; end: number; exact: string; prefix: string; suffix: string; projectionSha256: string };
export type RangeComment = { id: string; kind: 'range'; body: string; color: ReviewColor; anchor: Anchor };
export type ReviewComment = RangeComment | { id: string; kind: 'overall'; body: string };
export type Score = { criterionId: string; levelId: string; value: string };
export type ReviewDraft = { scores: Score[]; comments: ReviewComment[]; overallCommentId: string | null };
export const emptyReview: ReviewDraft = { scores:[],comments:[],overallCommentId:null };

function utf16Boundary(text: string, offset: number) {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  const left = text.charCodeAt(offset-1), right = text.charCodeAt(offset);
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}

export function reviewAnchor(text: string, projectionSha256: string, start: number, end: number): Anchor | null {
  if (!utf16Boundary(text,start) || !utf16Boundary(text,end) || end <= start || end-start > 2000) return null;
  return { start,end,exact:text.slice(start,end),prefix:text.slice(Math.max(0,start-32),start),suffix:text.slice(end,end+32),projectionSha256 };
}

export function reviewTotal(scores: Score[], rubric: RubricSnapshot) {
  const cents = (value: string) => Math.round(Number(value)*100);
  const score = scores.reduce((total,item) => total+cents(item.value),0);
  const scale = cents(rubric.scale), max = cents(rubric.max);
  return Math.floor((2*score*scale+max)/(2*max))/100;
}

export const reviewMessages: Record<string,string> = {
  LEASE_HELD:'Nháp chấm đang được sửa ở nơi khác.',
  STALE_WRITER:'Quyền sửa nháp chấm đã chuyển sang phiên khác.',
  CLASS_INACTIVE:'Lớp đã lưu trữ. Mở lại lớp để tiếp tục chấm.',
  SUBMISSION_CONFLICT:'Bản nộp đã thay đổi trên Drive. Vườn Văn giữ bản nháp chấm đã lưu.',
  SUBMISSION_MISSING:'Không tìm thấy bản nộp trên Drive.',
  SUBMISSION_UNAVAILABLE:'Chưa đọc được bản nộp trên Drive. Kiểm tra kết nối và quyền truy cập rồi thử lại.',
  SOURCE_UNVERIFIED:'Chưa xác minh được bản nộp. Mở lại bàn chấm để kiểm tra.',
  ANCHOR_CONFLICT:'Đoạn được chọn không còn khớp với bản nộp đã xác minh.',
  INVALID_REVIEW_DRAFT:'Kiểm tra mức điểm và nhận xét trước khi lưu nháp chấm.',
  RUBRIC_INCOMPLETE:'Chấm đủ tiêu chí để trả bài.',
  REVIEW_REJECTED:'Lần trả bài này đã bị chặn. Mở lại bàn chấm để thử lại.',
  COMMENT_LOCKED:'Nhận xét đã có phản hồi hoặc đang được phản hồi.',
  DRAFT_CHANGED:'Nháp chấm đã thay đổi. Tải lại để mở bản mới nhất.',
  DRIVE_INTEGRITY:'Tệp chấm hoặc rubric trên Drive không còn khớp với bản đã lưu.'
};
