import { AVATARS } from './characters';

const blockedWords = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'nigga', 'rape'];

export function sanitizeNickname(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[<>"'`]/g, '')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

function nicknameCandidate(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[<>"'`]/g, '')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nicknameError(input: string): string | null {
  const name = nicknameCandidate(input);
  const length = Array.from(name).length;
  if (length < 2) return 'Tên cần có ít nhất 2 ký tự.';
  if (length > 16) return 'Tên chỉ được dài tối đa 16 ký tự.';
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (blockedWords.some((word) => compact.includes(word))) return 'Hãy chọn một tên thân thiện hơn nhé.';
  return null;
}

export function isValidAvatar(id: string): boolean {
  return AVATARS.some((avatar) => avatar.id === id);
}

export function cleanMessage(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function filterMessage(input: string): string {
  return cleanMessage(input).replace(/\b(fuck|shit|bitch|asshole|cunt|nigger|nigga)\b/gi, (word) => '•'.repeat(word.length));
}
