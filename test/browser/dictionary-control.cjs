const { expect } = require("@playwright/test");

async function dictionaryRoot(page,label){
  const input=page.getByLabel(label,{exact:true});
  const root=input.locator("xpath=ancestor::*[@data-dictionary][1]");
  await expect(root).toHaveAttribute("data-ready","true");
  return {input,root};
}
async function chooseDictionary(page,label,query,optionText=query){
  const {input,root}=await dictionaryRoot(page,label);
  const tag=await input.evaluate(el=>el.tagName);
  if(tag==="SELECT"){
    await input.selectOption({label:optionText});
    await expect(input.locator("option:checked")).toHaveText(optionText);
    return input;
  }
  await input.click();await input.fill(query);
  const option=root.locator('[role="option"]').filter({hasText:optionText}).first();
  await expect(option).toBeVisible();await option.click();
  await expect(input).toHaveValue(optionText);await expect(input).toHaveAttribute("aria-expanded","false");
  return root.locator('input[type="hidden"]');
}
async function clearDictionary(page,label){
  const {input,root}=await dictionaryRoot(page,label);const tag=await input.evaluate(el=>el.tagName);
  if(tag==="SELECT"){await input.selectOption("");await expect(input).toHaveValue("");return input;}
  await root.getByRole("button",{name:`清除${label}`,exact:true}).click();await expect(input).toHaveValue("");
  return root.locator('input[type="hidden"]');
}
module.exports={dictionaryRoot,chooseDictionary,clearDictionary};
