export type ClashClip = { id:string;name:string;art_url:string;moment_tags:string[];clip_asset_id:string|null;thumbnail_asset_id:string|null;clip_start_ms:number|null;clip_end_ms:number|null;moment_description:string|null };
export type ClashState = {
 match:{id:string;invite_code:string|null;status:'waiting'|'active'|'completed'|'cancelled'|'expired';mode:'pvp'|'cpu';current_round:number;winner_seat:number|null;draw:boolean};seat:number;
 players:{seat:number;cpu:boolean;score:number;ready_at:string|null}[];
 lineups:{seat:number;slot:number;card_id:string;snapshot:ClashClip}[];
 rounds:{number:number;status:'open'|'resolved';winner_seat:number|null;prompt_snapshot:{title:string;description:string;weights:Record<string,number>};submissions:{seat:number;card_id:string;score:number|null;explanation:{tag:string;points:number}[]|null}[]}[];
};
