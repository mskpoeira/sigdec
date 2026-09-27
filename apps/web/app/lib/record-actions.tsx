"use client";

type RecordActionsProps={
 onEdit?:()=>void;
 onArchive?:()=>void|Promise<void>;
 onRestore?:()=>void|Promise<void>;
 onDelete?:()=>void|Promise<void>;
 archived?:boolean;
 busy?:boolean;
 editLabel?:string;
 archiveLabel?:string;
 deleteLabel?:string;
};

async function confirmed(message:string,action?:()=>void|Promise<void>){
 if(!action||!window.confirm(message))return;
 await action();
}

export function RecordActions({onEdit,onArchive,onRestore,onDelete,archived=false,busy=false,editLabel="Editar",archiveLabel="Arquivar",deleteLabel="Excluir"}:RecordActionsProps){
 return <div className="recordActions" role="group" aria-label="Ações do registro">
  {onEdit&&<button type="button" className="recordActionButton" disabled={busy||archived} onClick={onEdit}>✍️ {editLabel}</button>}
  {!archived&&onArchive&&<button type="button" className="recordActionButton" disabled={busy} onClick={()=>void confirmed("Arquivar este registro? Ele sairá da operação ativa, mas poderá ser restaurado.",onArchive)}>🗄️ {archiveLabel}</button>}
  {archived&&onRestore&&<button type="button" className="recordActionButton" disabled={busy} onClick={()=>void onRestore()}>♻️ Restaurar</button>}
  {onDelete&&<button type="button" className="recordActionButton recordActionDanger" disabled={busy} onClick={()=>void confirmed("Excluir este registro? Esta ação respeitará as regras de retenção e auditoria do SIGDEC.",onDelete)}>➖ {deleteLabel}</button>}
 </div>
}
