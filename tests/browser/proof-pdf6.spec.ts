import { test, expect } from '@playwright/test';

// Synthetic vectors only: portrait, landscape, square; no customer data or actions.
function fixturePdf() {
  const sizes = [[300,500],[500,300],[400,400]];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'];
  sizes.forEach(([w,h],i)=>{
    const stream = `${i===0?'0.2 0.5 0.3':i===1?'0.3 0.4 0.7':'0.7 0.4 0.2'} rg 20 20 ${w-40} ${h-40} re f`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << >> /Contents ${4+i*2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  return Buffer.from(pdf+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

for (const mode of ['multipage','failure','switch during load'] as const) test(`PDF6 ${mode}`,async({page,context})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin==='http://127.0.0.1:5190'&&!u.pathname.startsWith('/api/')&&!u.pathname.endsWith('.pdf'))return route.continue();
    if(u.hostname==='assets.fixture.invalid'||u.origin==='http://127.0.0.1:5190'&&u.pathname.endsWith('.pdf')){
      if(u.pathname.endsWith('.pdf')){
        if(mode==='switch during load')await gate;
        return route.fulfill({status:mode==='failure'?500:200,contentType:'application/pdf',body:mode==='failure'?'unavailable':fixturePdf()}).catch(()=>{});
      }
      return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'});
    }
    return route.abort();
  });
  await page.setViewportSize({width:1366,height:768});
  await page.goto('/proof#/proof/assets-qa');
  const viewer=page.locator('.preview-stage .proof-document-viewer');
  if(mode==='multipage'){
    const canvas=viewer.locator('canvas');
    const dimensions=()=>canvas.evaluate(c=>({w:c.width,h:c.height}));
    await expect(viewer.getByRole('button',{name:'Next page'})).toBeVisible();
    await expect.poll(async()=>{const d=await dimensions();return d.h>d.w;}).toBe(true);
    await viewer.getByRole('button',{name:'Next page'}).click();
    await expect.poll(async()=>{const d=await dimensions();return d.w>d.h;}).toBe(true);
    await page.screenshot({path:'output/playwright/pdf6-landscape.png'});
    await viewer.getByRole('button',{name:'Rotate clockwise'}).click();
    await expect.poll(async()=>{const d=await dimensions();return d.h>d.w;}).toBe(true);
    await viewer.getByRole('button',{name:'Next page'}).click();
    await expect(viewer.getByRole('button',{name:'Next page'})).toBeDisabled();
    await expect.poll(async()=>{const d=await dimensions();return d.h===d.w&&d.w>0;}).toBe(true);
    await viewer.getByRole('button',{name:'Previous page'}).click();
    await expect(viewer.locator('.proof-page-indicator')).toHaveText('2 / 3');
  }else if(mode==='failure'){
    await expect(page.locator('.preview-stage').getByText('Full-resolution preview unavailable',{exact:true})).toBeVisible();
  }else{
    await expect(viewer).toBeVisible();
    await page.getByRole('button',{name:'Creative 2: north-wall-layered-production-artwork-with-linked-assets.psd; Pending',exact:true}).click();
    release();
    await expect(page.locator('.preview-stage').getByText('Full-resolution file',{exact:true})).toBeVisible();
    await expect(viewer).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
