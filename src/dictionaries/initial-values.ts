// Explicit initial catalog, not inferred from user products. Condition labels follow VC; see docs/CONDITION-STANDARD.md.
import { createHash } from "node:crypto";
import { type DictionaryKind } from "./dictionary-rules";
export function initialId(kind: string, code: string) {
  const h = createHash("sha256")
    .update("tome.dictionary.v1/" + kind + "/" + code)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
type Input = [string, string, string, string?, string[]?];
const brands: Input[] = [
  ["LOUIS_VUITTON", "Louis Vuitton", "Louis Vuitton", "", ["LV", "路易威登"]],
  ["CHANEL", "Chanel", "Chanel", "", ["香奈儿"]],
  ["DIOR", "Dior", "Dior", "", ["迪奥", "Christian Dior"]],
  ["HERMES", "Hermès", "Hermès", "", ["Hermes", "爱马仕"]],
  ["GUCCI", "Gucci", "Gucci", "", ["古驰"]],
  ["PRADA", "Prada", "Prada", "", ["普拉达"]],
  ["FENDI", "Fendi", "Fendi", "", ["芬迪"]],
  ["CELINE", "Celine", "Celine", "", ["思琳"]],
  ["BALENCIAGA", "Balenciaga", "Balenciaga", "", ["巴黎世家"]],
  [
    "SAINT_LAURENT",
    "Saint Laurent",
    "Saint Laurent",
    "",
    ["YSL", "圣罗兰", "Yves Saint Laurent"],
  ],
  ["BOTTEGA_VENETA", "Bottega Veneta", "Bottega Veneta", "", ["葆蝶家", "BV"]],
  ["LOEWE", "Loewe", "Loewe", "", ["罗意威"]],
  [
    "JEAN_PAUL_GAULTIER",
    "Jean Paul Gaultier",
    "Jean Paul Gaultier",
    "",
    ["JPG", "高缇耶"],
  ],
  ["ISSEY_MIYAKE", "Issey Miyake", "Issey Miyake", "", ["三宅一生"]],
  [
    "COMME_DES_GARCONS",
    "Comme des Garçons",
    "Comme des Garçons",
    "",
    ["CDG", "Comme des Garcons"],
  ],
  ["YOHJI_YAMAMOTO", "Yohji Yamamoto", "Yohji Yamamoto", "", ["山本耀司"]],
  [
    "MAISON_MARGIELA",
    "Maison Margiela",
    "Maison Margiela",
    "",
    ["Maison Martin Margiela"],
  ],
  [
    "VIVIENNE_WESTWOOD",
    "Vivienne Westwood",
    "Vivienne Westwood",
    "",
    ["薇薇安韦斯特伍德"],
  ],
  ["MIU_MIU", "Miu Miu", "Miu Miu"],
  ["ALEXANDER_MCQUEEN", "Alexander McQueen", "Alexander McQueen"],
  ["RICK_OWENS", "Rick Owens", "Rick Owens"],
  ["CHLOE", "Chloé", "Chloé", "", ["Chloe"]],
  ["BURBERRY", "Burberry", "Burberry", "", ["博柏利"]],
  ["VALENTINO", "Valentino", "Valentino", "", ["华伦天奴"]],
];
const conditions: Input[] = [
  [
    "NEVER_WORN_WITH_TAG",
    "未使用，有原装标签",
    "Never worn, with tag",
    "从未使用，保留原装标签；请核对标签和实物状态。",
  ],
  [
    "NEVER_WORN",
    "未使用",
    "Never worn",
    "从未使用；不能用“看起来很新”代替未使用事实。",
  ],
  [
    "VERY_GOOD",
    "非常好",
    "Very good condition",
    "轻微使用痕迹；具体痕迹仍需描述并配图。",
  ],
  [
    "GOOD",
    "良好",
    "Good condition",
    "有使用痕迹或小瑕疵；逐项说明位置和程度。",
  ],
  [
    "FAIR",
    "一般",
    "Fair condition",
    "经常使用，或有明显瑕疵；明确披露，不等同于无须检查即可发布。",
  ],
];
const colors: Input[] = [
  ["BLACK", "黑色", "Black"],
  ["WHITE", "白色", "White"],
  ["GREY", "灰色", "Grey", "", ["gray"]],
  ["BROWN", "棕色", "Brown"],
  ["BEIGE", "米色", "Beige"],
  ["BLUE", "蓝色", "Blue"],
  ["RED", "红色", "Red"],
  ["GREEN", "绿色", "Green"],
  ["PINK", "粉色", "Pink"],
  ["YELLOW", "黄色", "Yellow"],
  ["PURPLE", "紫色", "Purple"],
  ["ORANGE", "橙色", "Orange"],
  ["GOLD", "金色", "Gold"],
  ["SILVER", "银色", "Silver"],
  ["MULTICOLOR", "多色", "Multicolor"],
];
const materials: Input[] = [
  ["WOOL", "羊毛", "Wool"],
  ["COTTON", "棉", "Cotton"],
  ["SILK", "真丝", "Silk"],
  ["LINEN", "亚麻", "Linen"],
  ["CASHMERE", "羊绒", "Cashmere"],
  ["LEATHER", "皮革", "Leather"],
  ["SUEDE", "绒面皮", "Suede"],
  ["CANVAS", "帆布", "Canvas"],
  ["DENIM", "丹宁", "Denim"],
  ["NYLON", "尼龙", "Nylon"],
  ["POLYESTER", "聚酯纤维", "Polyester"],
  ["BLEND", "混纺", "Blend"],
  ["METAL", "金属", "Metal"],
];
export const initialDictionaryValues = (
  [
    ["BRAND", brands],
    ["CONDITION", conditions],
    ["COLOR", colors],
    ["MATERIAL", materials],
  ] as [DictionaryKind, Input[]][]
).flatMap(([kind, rows]) =>
  rows.map(([code, label, labelEn, description = "", aliases = []], index) => ({
    id: initialId(kind, code),
    kind,
    code,
    label,
    labelEn,
    description,
    aliases,
    categories: [] as string[],
    sortOrder: index * 10,
    active: true,
    version: 1,
  })),
);
