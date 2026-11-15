export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const PAYMENTS = process.env.NEXT_PUBLIC_PAYMENTS_URL ?? 'http://localhost:4100';
export class ApiError extends Error { constructor(public status:number, message:string){super(message);} }
export async function request<T>(path:string, body?:unknown, origin=API):Promise<T> {
 const res=await fetch(origin+path,{credentials:'include',cache:'no-store', ...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 if(!res.ok){ const error=await res.json().catch(()=>null);throw new ApiError(res.status,error?.error?.message??`Request failed (${res.status})`); }
 return res.status===204?undefined as T:res.json();
}
export const art=(url:string)=>url.startsWith('/')?API+url:url;
