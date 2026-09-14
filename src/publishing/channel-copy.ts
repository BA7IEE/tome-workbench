import type { Facts } from "../common/domain";
import { titleWithCode } from "../common/domain";
// Deterministic layout of confirmed facts; this is not an AI call or proof of platform policy compliance.
export function channelCopy(input: {
  code: string;
  title: string;
  brand: string;
  facts: Facts;
  platform: string;
  locale: string;
  titleLimit: number;
}) {
  const { facts: f, platform, locale, code } = input,
    en = locale === "en";
  const details = [
    [en ? "Brand" : "品牌", input.brand],
    [en ? "Material" : "材质", f.material || f.mainMaterial],
    [
      en ? "Condition grade (internal)" : "成色等级",
      en ? f.conditionGradeEn || f.conditionGrade : f.conditionGrade,
    ],
    [en ? "Colour" : "颜色", f.color],
    [en ? "Label size" : "标注尺码", f.sizeLabel],
    [en ? "Measurements" : "实际尺寸", f.measurements],
    [en ? "Condition / disclosed defects" : "实际品相 / 瑕疵", f.condition],
  ]
    .filter(([, v]) => v)
    .map(([label, value]) => `${label}：${value}`);
  const claims = f.research
    .filter((r) => r.confirmed && r.evidence)
    .map((r) => r.claim);
  let body: string;
  if (en) {
    body = [f.descriptionEn, details.join("\n"), `Item reference: ${code}`]
      .filter(Boolean)
      .join("\n\n");
  } else if (platform === "XHS") {
    body = [
      f.descriptionZh,
      claims.length ? "这件商品的资料线索\n" + claims.join("\n") : "",
      "实物信息\n" + details.join("\n"),
      "商品编号：" + code,
    ]
      .filter(Boolean)
      .join("\n\n");
  } else {
    body = [
      f.descriptionZh,
      details.join("\n"),
      claims.length ? "已核对资料\n" + claims.join("\n") : "",
      "商品编号：" + code,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return {
    title: titleWithCode(input.title, code, input.titleLimit),
    body,
    templateVersion: "tome-layout-1",
    notice: en
      ? "英文模板保留原资料；尚未翻译的字段仍需人工核对，不会自动改写实物信息。"
      : "由已确认资料按渠道排版；未调用AI，不补写未经确认的年份、稀缺性或保证。",
  };
}
