export type JsonRecord=Record<string,any>;
export class DraftError extends Error {constructor(readonly code:string,readonly status:number,message:string){super(message);}}
export interface DraftEntry {id:string;revision:number;blob:string;poIdentities:string[];holds:string[];updatedAt:string;actor:string;snapshots:{id:string;blob:string;at:string;actor:string;revision:number;payloadHash:string}[]}
export interface DraftState {revision:number;drafts:Record<string,DraftEntry>;requests:Record<string,{hash:string;draftId:string;blob:string;revision:number}>}
export interface DraftRepository {
 read():Promise<DraftState>;
 blob(hash:string):Promise<JsonRecord>;
 put(value:JsonRecord):Promise<string>;
 commit(expected:number,state:DraftState):Promise<boolean>;
}
export const emptyDraftState=():DraftState=>({revision:0,drafts:{},requests:{}});
