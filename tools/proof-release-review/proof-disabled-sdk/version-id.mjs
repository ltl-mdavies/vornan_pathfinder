export const validVersionId=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&value!=='null'&&!/[\s\x00-\x1f\x7f]/.test(value);
