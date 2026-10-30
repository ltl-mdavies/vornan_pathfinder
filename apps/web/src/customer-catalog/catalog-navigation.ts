export type CatalogNavigationState={customerId:string;dirty:boolean;busy:boolean;unconfirmed:boolean};
export type CatalogNavigationController={snapshot():CatalogNavigationState;discardUnsaved():boolean};
/** Shell navigation reads this synchronous state before any async save yields. */
export function createCatalogNavigation(customerId:string,discard:()=>void){
 let current:CatalogNavigationState={customerId,dirty:false,busy:false,unconfirmed:false};
 return {
  update(patch:Partial<Omit<CatalogNavigationState,'customerId'>>){current={...current,...patch};},
  snapshot:()=>({...current}),
  discardUnsaved(){if(current.busy||current.unconfirmed)return false;discard();current={...current,dirty:false};return true;}
 };
}
