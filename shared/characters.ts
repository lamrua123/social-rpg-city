export type Avatar = {
  id: string;
  name: string;
  skin: string;
  hair: string;
  coat: string;
  trim: string;
  hairStyle: 'bob' | 'cap' | 'curls' | 'long' | 'bun' | 'fringe' | 'hood' | 'crop';
};

export const AVATARS: Avatar[] = [
  { id: 'moss', name: 'Rêu', skin: '#f2c69b', hair: '#50372e', coat: '#4e9380', trim: '#f1c766', hairStyle: 'crop' },
  { id: 'sunday', name: 'Nắng', skin: '#b97853', hair: '#302824', coat: '#d9745d', trim: '#f4d9aa', hairStyle: 'bob' },
  { id: 'cloud', name: 'Mây', skin: '#f5d8b3', hair: '#efbd58', coat: '#688bb1', trim: '#f4e3c2', hairStyle: 'cap' },
  { id: 'juniper', name: 'Bách', skin: '#d59a76', hair: '#37313a', coat: '#c576a0', trim: '#f5dca4', hairStyle: 'long' },
  { id: 'fern', name: 'Dương Xỉ', skin: '#8e5745', hair: '#312921', coat: '#d4a94f', trim: '#f4e3c2', hairStyle: 'bun' },
  { id: 'bluebell', name: 'Chuông Xanh', skin: '#f0bd91', hair: '#bd684d', coat: '#6f9e8a', trim: '#f3d49b', hairStyle: 'curls' },
  { id: 'ember', name: 'Đốm Lửa', skin: '#c98761', hair: '#473649', coat: '#7c76a8', trim: '#f0c66f', hairStyle: 'hood' },
  { id: 'rowan', name: 'Thanh', skin: '#edc8a5', hair: '#806044', coat: '#6e9fba', trim: '#f3e6c9', hairStyle: 'fringe' },
];

export function avatarFor(id: string): Avatar {
  return AVATARS.find((avatar) => avatar.id === id) ?? AVATARS[0];
}
