/** Local adapter composition; no credentials, SDK or remote requests. */
export function guardedApprovalWrites(io,lease){
 const wrap=(target,call)=>async(...args)=>{
  const permit=await lease.beforeWrite(target(...args));
  let result;
  try{result=await call(...args);}
  catch{
   try{await lease.outcome(permit,'uncertain');}catch{/* Existing intent must be reconciled. */}
   throw Error('Write outcome uncertain; read-only reconciliation required');
  }
  await lease.outcome(permit,'confirmed');
  return result;
 };
 return {
  read:(...a)=>io.read(...a),readConfig:(...a)=>io.readConfig(...a),verifyPublic:(...a)=>io.verifyPublic(...a),
  createOnly:wrap(key=>key,(...a)=>io.createOnly(...a)),
  replaceIndex:wrap(()=>'index.html',(...a)=>io.replaceIndex(...a))
 };
}
