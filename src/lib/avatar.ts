// 渐变彩色头像：按索引取一组配色，返回 CSS 渐变字符串 + 首字母。

const GRADIENTS: [string, string][] = [
  ["#6C8EEF", "#8E6CC4"], // 蓝→紫
  ["#3DD68C", "#2BB8C9"], // 绿→青
  ["#FFB454", "#F0556E"], // 橙→红
  ["#C46CC4", "#8E6CC4"], // 粉→紫
  ["#FFD93D", "#FF9F43"], // 黄→橙
  ["#2BB8C9", "#6C8EEF"], // 青→蓝
];

export function gradientFor(index: number): string {
  const [c1, c2] = GRADIENTS[index % GRADIENTS.length];
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}

export function initialOf(name: string): string {
  const t = (name || "").trim();
  if (!t) return "?";
  return t[0].toUpperCase();
}
