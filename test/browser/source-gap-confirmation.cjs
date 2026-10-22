// Explicit user acknowledgements for source limitations; never bypass an application check.
async function acceptSourceGaps(dialog) {
  const fields = dialog.getByLabel("我同意保留上述来源缺项，确认入库后继续整理", { exact: true });
  if (await fields.count()) await fields.check();
  const images = dialog.getByLabel(/件来源图片不足：仅按现有资料入库/);
  if (await images.count()) await images.check();
}
module.exports = { acceptSourceGaps };
