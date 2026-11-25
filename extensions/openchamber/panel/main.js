"use strict";(()=>{var _="openchamber.sdk";var ke="data-oc-scrolling",Ze=`
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${ke}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${ke}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${ke}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${ke}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function Zt(e){let r=e.documentElement;if(r.hasAttribute("data-oc-scrollbar-activity"))return;r.setAttribute("data-oc-scrollbar-activity","");let n=new WeakMap;e.addEventListener("scroll",a=>{let i=a.target===e?r:a.target;if(!(i instanceof Element))return;i.hasAttribute("data-oc-scrolling")||i.setAttribute("data-oc-scrolling","");let S=n.get(i);S!==void 0&&clearTimeout(S),n.set(i,setTimeout(()=>{n.delete(i),i.removeAttribute("data-oc-scrolling")},1e3))},{capture:!0,passive:!0})}var sr=`(${Zt.toString()})(document);`;var eo=e=>{let r=[],n=0,a=0;return{push:i=>{for(r.push(i),a+=i.length;a-n>e&&r.length>1;){let S=r.shift();a-=S?.length??0,n=0}},pull:i=>{let S=0;for(;S<i.length&&r.length>0;){let g=r[0],m=Math.min(i.length-S,g.length-n);i.set(g.subarray(n,n+m),S),S+=m,n+=m,n>=g.length&&(r.shift(),a-=g.length,n=0)}i.fill(0,S)},clear:()=>{r.length=0,n=0,a=0},get size(){return a-n}}};var no=/^[a-z][a-z0-9-]{0,39}$/;var to=e=>Object(e)===e&&!Array.isArray(e),et=(e,r)=>Object.keys(e).every(n=>r.includes(n)),oo=e=>String(e)===e&&e.length>=1&&e.length<=60,ro=e=>String(e)===e&&e.length>=1&&e.length<=80,so=e=>{if(!Array.isArray(e)||e.length>4)return!1;let r=new Set;for(let n of e){if(!to(n)||!no.test(n.id)||!oo(n.label)||n.disabled!==void 0&&n.disabled!==!0&&n.disabled!==!1||r.has(n.id))return!1;if(r.add(n.id),n.kind==="button"){if(!et(n,["kind","id","label","disabled"]))return!1;continue}if(n.kind!=="select"||!et(n,["kind","id","label","value","options","disabled"])||!ro(n.value)||!Array.isArray(n.options)||n.options.length<1||n.options.length>16)return!1;let a=new Set;for(let i of n.options){if(!to(i)||!et(i,["value","label"])||!ro(i.value)||!oo(i.label)||a.has(i.value))return!1;a.add(i.value)}if(!a.has(n.value))return!1}return!0};var ar=1024*1024;var io=["{id}","{segment}","{segments+}"];var qr=new Set(io);var ao=["turn-finished","turn-failed","permission-asked","question-asked","turn-started","session-created","session-archived","session-deleted"];var Yr=new Set(ao);var tt=e=>"bytes"in e?e.bytes.byteLength:e.content.length,co=(e,r)=>{if(e.path!==r.path||e.readOnly!==r.readOnly)return!1;if(e.encoding==="text"||r.encoding==="text")return e.encoding==="text"&&r.encoding==="text"&&e.content===r.content;if(e.bytes.byteLength!==r.bytes.byteLength)return!1;for(let n=0;n<e.bytes.byteLength;n+=1)if(e.bytes[n]!==r.bytes[n])return!1;return!0};var lo=/^[A-Za-z0-9_-]{1,80}$/;var uo=["left","right","top","bottom"];var po=(e,r=0,n={remaining:16e3})=>{if(--n.remaining<0||r>=32)return!1;if(e===null)return!0;let a=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let i of a)if(!po(i,r+1,n))return!1;return!0},ot=e=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every(r=>/^(0|[1-9]\d*)$/.test(r)&&Number(r)<e.length)&&e.every(ot);if(Object(e)===e){let r=Object.getPrototypeOf(e);return(r===null||r===Object.prototype)&&Object.values(e).every(ot)}return String(e)===e||Number.isFinite(e)},rt=e=>{try{return String(e.id)!==e.id||!lo.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!uo.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!po(e.data)||!ot(e.data)?!1:JSON.stringify(e.data).length<=16e3}catch{return!1}};var Eo=/^[0-9a-f]{7,64}$/i,_o=e=>Eo.test(e),nt=255,To=(e,r,n)=>({openCommit:a=>_o(a)?e({channel:_,v:1,type:"open-commit",id:r(),payload:{sha:a}}):n("Commit id must be 7 to 64 hex characters."),openWalkthrough:({base:a})=>{let i=a.trim();return!i||i.length>nt?n(`Base must contain 1 to ${nt} characters.`):e({channel:_,v:1,type:"open-walkthrough",id:r(),payload:{base:i}})}});var it=2e3;var fo=["file","directory","other","missing"],at=e=>!!(e&&"sessionId"in e),ct=e=>!!(e&&"sent"in e&&!("sessionId"in e));var Ce=500,Ue=32e3,Ao=16e3,Oo=128,Ro=200,ho=2e3,mo=16e3,go=80,Io=200,xo=16e3;var bo=2e3;var lt=2e4,Me=1024,ye=2e6;var Ne=64e3,ve=8e3,dt=4e3;var ut=96e4,cr=60*6e4;var ko=999,Co=1e4,Ae=500,Uo=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],Mo=["stopped","starting","ready","failed"],lr=new Set(Uo),yo=e=>lr.has(e),No=e=>e&&yo(e)?e:"HOST_REJECTED",se=e=>e===void 0?!1:e===null||e===!0||e===!1||String(e)===e?!0:Number(e)===e?Number.isFinite(e):Array.isArray(e)?e.every(se):Object(e)===e?Object.values(e).every(se):!1,vo=e=>se(e)&&JSON.stringify(e).length<=xo,So=e=>e?.trim().slice(0,Io)??"",ie=e=>{let r=e.id.trim().slice(0,Oo),n=e.title.trim().slice(0,Ro),a=e.url.trim().slice(0,ho),i=e.text?.trim().slice(0,mo),S=e.author?.trim().slice(0,go),g=e.kind==="pull"?"pull":"issue",m={providerId:e.providerId.trim(),id:r,title:n||r,url:a,kind:g};if(i&&(m.text=i),S&&(m.author=S),g==="pull"){let P=So(e.branches?.head),w=So(e.branches?.base);P&&w&&(m.branches={head:P,base:w})}return vo(e.data)&&(m.data=e.data),m},pt=e=>{let r=ie(e);return e.projectId&&(r.projectId=e.projectId),e.navigation&&(r.navigation=e.navigation),e.worktree&&(r.worktree=e.worktree),r},Et=e=>{let r={text:e.text.trim().slice(0,Ao)};return e.send&&(r.send=!0),r},_t=e=>e===null||!Number.isFinite(e)?null:Math.min(ko,Math.max(0,Math.round(e))),Tt=e=>Number.isFinite(e)?Math.min(Co,Math.max(0,Math.ceil(e))):0;var ae=e=>e.length>0&&e.length<=Me&&!e.includes("\0")&&!e.includes("\\");var Le=e=>!e.startsWith("/")||e.includes("\0")||e.includes("\\")||e.includes("://")||e.length>bo?!1:!e.split("/").some(n=>n==="."||n===".."),dr=new Set(Mo),St=e=>!!(e&&"status"in e&&dr.has(String(e.status))&&!("body"in e)),Pe=e=>!!(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),ft=e=>!!(e&&"content"in e&&String(e.content)===e.content),At=e=>!!(e&&"written"in e&&e.written===!0),Ot=e=>!!(e&&"entries"in e&&Array.isArray(e.entries)),ur=new Set(fo),Rt=e=>!!(e&&"kind"in e&&"size"in e&&ur.has(String(e.kind))&&Number.isFinite(e.size)),ht=e=>!!(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),pr=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","service-event","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late","microphone-audio","microphone-ended"]),Er=e=>Object(e)===e?e:null,st=e=>String(e)===e&&e.length>0,_r=e=>{if(!st(e.id))return null;if(e.ok===!0){let r={channel:_,v:1,type:"result",id:e.id,ok:!0};return Object(e.payload)===e.payload&&(r.payload=e.payload),r}return e.ok===!1&&st(e.error)?{channel:_,v:1,type:"result",id:e.id,ok:!1,error:e.error,code:No(st(e.code)?e.code:void 0)}:null},mt=e=>{let r=Er(e);return!r||r.channel!==_||r.v!==1?null:r.type==="result"?_r(r):!pr.has(String(r.type))||Object(r.payload)!==r.payload?null:r};var Lo=e=>"key"in e&&"metaKey"in e&&"ctrlKey"in e,Tr=e=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s",d=class extends Error{code;constructor(r,n){super(n),this.name="HostRequestError",this.code=r}},Po=()=>Promise.reject(new d("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),we=()=>Promise.reject(new d("BAD_PATH",`File path must be 1 to ${Me} characters without NUL or backslash.`)),De=e=>{if(e!==void 0){if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new d("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0}},E=e=>(e.value+=1,`oc-${e.value}`),kt=(e={})=>{let r=e.target??("window"in globalThis?window:null);if(!r)throw new d("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let n=e.acceptSource??(t=>t===r.parent),a=e.requestTimeoutMs??lt,i=new Set,S=new Set,g=new Set,m=new Set,P=new Set,w=new Set,H=new Set,q=new Set,J=new Set,$=new Set,he=new Set,ee=new Set,je=[],pe=null,Ee=null,me=new Set,ge=new Set,_e=null,Te=null,ze=!1,te=new Map,oe=new Map,re=new Map,V=!1,p={value:0},u=null,K=null,Se=!1,fe=!1,$t=null,D=null,Vt=t=>t?{sessionId:t.id,phase:t.busy?"started":"completed"}:null,M=t=>{r.parent.postMessage(t,"*")},Ft=()=>{V||r.parent===r||ee.size===0||u?.features?.lateGenerateResults!==!0||M({channel:_,v:1,type:"generate-late-listen"})},O=(t,o)=>{for(let l of t)try{l(o)}catch(c){console.error(c)}},Bt=t=>{if(!(t instanceof MessageEvent)||!n(t.source))return;let o=mt(t.data);if(!o)return;if(o.type==="workspace"){let c=oe.get(o.payload.subscriptionId);c&&O([c],o.payload.snapshot);return}if(o.type==="shells"){let c=re.get(o.payload.subscriptionId);c&&O([c],o.payload.snapshot);return}if(o.type==="microphone-audio"){D?.queue.push(o.payload.samples);return}if(o.type==="microphone-ended"){let c=D;if(!c)return;D=null,c.release(),O(c.endedListeners,o.payload.reason);return}if(o.type==="ready"){u=o.payload,K=Vt(o.payload.session),O(i,o.payload),O(S,o.payload.directory),O(g,o.payload.session),K&&O(m,K),O(P,o.payload.connection),O(w,o.payload.settings),O(H,o.payload.item),o.payload.block&&O(q,o.payload.block),Ft();return}if(o.type==="service-event"){O(J,o.payload);return}if(o.type==="generate-late"){ee.size===0?je.push(o.payload):O(ee,o.payload);return}if(o.type==="directory"){u&&(u={...u,directory:o.payload.directory}),O(S,o.payload.directory);return}if(o.type==="session"){u&&(u={...u,session:o.payload.session}),o.payload.session?K?.sessionId!==o.payload.session.id&&(K=Vt(o.payload.session)):K=null,O(g,o.payload.session);return}if(o.type==="session-lifecycle"){K=o.payload,O(m,o.payload);return}if(o.type==="connection"){u&&(u={...u,connection:o.payload.connection}),O(P,o.payload.connection);return}if(o.type==="settings"){u&&(u={...u,settings:o.payload.settings}),O(w,o.payload.settings);return}if(o.type==="item"){u&&(u={...u,item:o.payload.item}),O(H,o.payload.item);return}if(o.type==="status-control-event"){O($,o.payload);return}if(o.type==="popover-closed"){O(he,o.payload);return}if(o.type==="action"){let c=A=>{V||M({channel:_,v:1,type:"action-result",id:o.id,payload:A})},f=Ee;if(!f){c({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>f(o.payload)).then(()=>c({ok:!0}),A=>{let R=(A instanceof Error?A.message:String(A)).trim();c({ok:!1,error:(R||"Action failed.").slice(0,Ae)})});return}if(o.type==="file-open"){let c=o.payload;if(Te&&co(Te,c))return;Te=c,O(me,o.payload);return}if(o.type==="file-saved"){O(ge,o.payload.version);return}if(o.type==="file-snapshot"){let c=R=>{V||M({channel:_,v:1,type:"file-snapshot-result",id:o.id,payload:R})},f=R=>c({error:(R.trim()||"Could not read the edited file.").slice(0,Ae)}),A=_e;if(!A){f("This extension does not edit files.");return}Promise.resolve().then(()=>A(o.payload.purpose)).then(R=>{if(tt(R)>2e7){f(`The file is over ${2e7} ${"bytes"in R?"bytes":"characters"}.`);return}if(R.version.length>256){f(`The snapshot version is over ${256} characters.`);return}c({snapshot:"bytes"in R?{bytes:R.bytes,version:R.version}:{content:R.content,version:R.version}})},R=>f(R instanceof Error?R.message:String(R)));return}if(o.type==="resolve"){let c=A=>{M({channel:_,v:1,type:"resolve-result",id:o.id,payload:A})},f=pe;if(!f){c({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>f(o.payload)).then(A=>c({item:A?ie(A):null}),A=>{let R=(A instanceof Error?A.message:String(A)).trim();c({error:(R||"Command failed.").slice(0,Ae)})});return}let l=te.get(o.id);if(l){if(clearTimeout(l.timer),te.delete(o.id),o.ok){l.resolve(o.payload);return}l.reject(new d(o.code,o.error))}};r.addEventListener("message",Bt),M({channel:_,v:1,type:"hello"});let C=(t,o=a)=>V||r.parent===r?Promise.reject(new d("HOST_UNAVAILABLE","No host frame. This page is not in an iframe.")):new Promise((l,c)=>{let f=setTimeout(()=>{te.delete(t.id),c(new d("HOST_TIMEOUT","Host did not answer in time."))},o);te.set(t.id,{resolve:l,reject:c,timer:f}),M(t)}),k=t=>C(t).then(()=>{}),I={channel:_,v:1},qe=t=>{!V&&r.parent!==r&&M(t)},Kt=()=>qe({...I,type:"file-save"}),Je=()=>{!V&&r.parent!==r&&M({...I,type:"microphone-close",id:E(p)})},rr=async()=>{if(D)throw new d("HOST_REJECTED","The microphone is already open in this frame.");if(u?.features?.microphone!==!0)throw new d("UNSUPPORTED","This OpenChamber cannot share the microphone with extensions.");let t=globalThis.AudioContext;if(typeof t!="function")throw new d("UNSUPPORTED","This frame has no Web Audio.");let o=new t;if(o.sampleRate<8e3||o.sampleRate>192e3)throw o.close().catch(()=>{}),new d("UNSUPPORTED",`Audio at ${o.sampleRate} Hz is not supported.`);let l=o.state==="suspended"?o.resume().catch(()=>{}):void 0,c=eo(Math.round(o.sampleRate/4)),f=o.createScriptProcessor(1024,1,1);f.onaudioprocess=X=>c.pull(X.outputBuffer.getChannelData(0));let A=o.createMediaStreamDestination();f.connect(A);let R=new Set,ne={queue:c,endedListeners:R,release:()=>{f.onaudioprocess=null,f.disconnect(),c.clear();for(let X of A.stream.getTracks())X.stop();o.close().catch(()=>{})}};D=ne;try{let X=await C({...I,type:"microphone-open",id:E(p),payload:{sampleRate:o.sampleRate}},12e4);if(!X||!("opened"in X)||X.opened!==!0)throw new d("HOST_REJECTED","Host did not open the microphone.");if(await l,D!==ne)throw new d("DISCONNECTED","The microphone closed while it was opening.")}catch(X){throw D===ne&&(D=null),ne.release(),Je(),X}return{stream:A.stream,close:()=>{D===ne&&(D=null,ne.release(),Je())},onEnded:X=>(R.add(X),()=>{R.delete(X)})}},Wt=t=>{!Lo(t)||!Tr(t)||(t.preventDefault(),Kt())},jt=t=>{!Lo(t)||t.key!=="Escape"||u?.surface!=="popover"||!u.popover||(t.preventDefault(),Yt(u.popover.id,"escape").catch(()=>{}))},Ie=()=>{let t=u?.surface==="popover"?u.popover:void 0;if(!t)return;let o=Se||fe;$t!==o&&($t=o,Qt(t.id,o).catch(()=>{}))},xe=()=>{u?.surface!=="popover"||Se||(Se=!0,Ie())},zt=t=>{u?.surface!=="popover"||t.relatedTarget!==null||!Se||(Se=!1,Ie())},qt=()=>{u?.surface!=="popover"||fe||(fe=!0,Ie())},Jt=()=>{u?.surface!=="popover"||!fe||(fe=!1,Ie())},F=(t,o=1024)=>{if(!t.trim()||t.length>o)throw new d("HOST_REJECTED",`Identity must contain 1 to ${o} characters.`)},Ye=async t=>{t.kind!=="projects"&&F(t.projectId);let o=await C({...I,type:"workspace-read",id:E(p),payload:t});if(!o||!("kind"in o)||!("state"in o)||o.kind!==t.kind)throw new d("HOST_REJECTED","Host did not return workspace data.");return o},Qe=async(t,o)=>{t.kind!=="projects"&&F(t.projectId);let l=E(p);oe.set(l,o);try{await k({...I,type:"workspace-subscribe",id:E(p),payload:{subscriptionId:l,query:t}})}catch(c){throw oe.delete(l),V||M({...I,type:"workspace-unsubscribe",id:E(p),payload:{subscriptionId:l}}),c}return()=>{!oe.delete(l)||V||M({...I,type:"workspace-unsubscribe",id:E(p),payload:{subscriptionId:l}})}},nr=async(t,o)=>{t.kind==="session"&&F(t.sessionId),t.kind==="project"&&F(t.projectId);let l=E(p);re.set(l,o);try{await k({...I,type:"shells-subscribe",id:E(p),payload:{subscriptionId:l,scope:t}})}catch(c){throw re.delete(l),V||M({...I,type:"shells-unsubscribe",id:E(p),payload:{subscriptionId:l}}),c}return()=>{!re.delete(l)||V||M({...I,type:"shells-unsubscribe",id:E(p),payload:{subscriptionId:l}})}},be=async t=>{if("key"in t&&(t.key.length===0||t.key.length>128))throw new d("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!se(t.value))throw new d("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>65536)throw new d("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&u?.features?.deviceStorage!==!0)throw new d("UNSUPPORTED","This host does not support device storage.");let o=await C({...I,type:"storage",id:E(p),payload:t});if(!o||!("storage"in o)||o.op!==t.op)throw new d("HOST_REJECTED","Host did not return storage data.");return o},Yt=(t,o)=>u?.features?.popovers!==!0&&!(u?.surface==="popover"&&u.popover?.id===t)?Promise.reject(new d("UNSUPPORTED","This host does not support popovers.")):k({...I,type:"popover-close",id:E(p),payload:o?{id:t,reason:o}:{id:t}}),Qt=(t,o)=>u?.features?.popovers!==!0&&!(u?.surface==="popover"&&u.popover?.id===t)?Promise.reject(new d("UNSUPPORTED","This host does not support popovers.")):k({...I,type:"popover-anchor",id:E(p),payload:{id:t,active:o}});return r.addEventListener("keydown",jt,!0),r.addEventListener("pointerover",xe),r.addEventListener("pointermove",xe),r.addEventListener("pointerout",zt),r.addEventListener("focus",qt),r.addEventListener("blur",Jt),{onAction:t=>(Ee=t,()=>{Ee===t&&(Ee=null)}),listProjects:async()=>{let t=await Ye({kind:"projects"});if(t.kind!=="projects")throw new d("HOST_REJECTED","Expected projects.");return t},listWorktrees:async t=>{let o=await Ye({kind:"worktrees",projectId:t});if(o.kind!=="worktrees")throw new d("HOST_REJECTED","Expected worktrees.");return o},listSessions:async t=>{let o=await Ye({kind:"sessions",projectId:t});if(o.kind!=="sessions")throw new d("HOST_REJECTED","Expected sessions.");return o},onProjects:t=>Qe({kind:"projects"},o=>{o.kind==="projects"&&t(o)}),onWorktrees:(t,o)=>Qe({kind:"worktrees",projectId:t},l=>{l.kind==="worktrees"&&o(l)}),onSessions:(t,o)=>Qe({kind:"sessions",projectId:t},l=>{l.kind==="sessions"&&o(l)}),onRunningShells:(t,o)=>nr(t,o),readShellOutput:async(t,o)=>{F(t,128);let l=o?.cursor;if(l!==void 0&&(!Number.isInteger(l)||l<0))throw new d("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let c=o?.tailBytes;if(c!==void 0&&(!Number.isInteger(c)||c<1||c>65536))throw new d("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${65536}.`);let A=await C({...I,type:"shell-output",id:E(p),payload:{shellId:t,cursor:l,tailBytes:c}});if(!A||typeof A.output!="string"||!Number.isFinite(A.cursor))throw new d("HOST_REJECTED","Host did not return shell output.");return A},stopShell:async t=>{if(F(t,128),(await C({...I,type:"shell-stop",id:E(p),payload:{shellId:t}}))?.stopped!==!0)throw new d("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async t=>{F(t),await k({...I,type:"open-session",id:E(p),payload:{sessionId:t}})},storage:{get:async(t,o)=>{let l=De(o),c={op:"get",key:t};l&&(c.scope=l);let f=await be(c);return f.op==="get"&&f.found?f.value:void 0},set:async(t,o,l)=>{let c=De(l),f={op:"set",key:t,value:o};c&&(f.scope=c),await be(f)},delete:async(t,o)=>{let l=De(o),c={op:"delete",key:t};l&&(c.scope=l),await be(c)},keys:async t=>{let o=De(t),l={op:"keys"};o&&(l.scope=o);let c=await be(l);if(c.op!=="keys")throw new d("HOST_REJECTED","Expected storage keys.");return c.keys}},onReady:t=>(i.add(t),u&&t(u),()=>{i.delete(t)}),onDirectory:t=>(S.add(t),u&&t(u.directory),()=>{S.delete(t)}),onSession:t=>(g.add(t),u&&t(u.session),()=>{g.delete(t)}),onSessionLifecycle:t=>(m.add(t),K&&t(K),()=>{m.delete(t)}),onConnection:t=>(P.add(t),u&&t(u.connection),()=>{P.delete(t)}),onSettings:t=>(w.add(t),u&&t(u.settings),()=>{w.delete(t)}),onItem:t=>(H.add(t),u&&t(u.item),()=>{H.delete(t)}),onBlock:t=>(q.add(t),u?.block&&t(u.block),()=>{q.delete(t)}),onServiceEvent:t=>(J.add(t),()=>{J.delete(t)}),onStatusControl:t=>($.add(t),()=>{$.delete(t)}),onPopoverClosed:t=>(he.add(t),()=>{he.delete(t)}),setStatusControls:t=>u?.features?.statusControls!==!0?Promise.reject(new d("UNSUPPORTED","This host does not support status controls.")):so(t)?k({...I,type:"status-controls",id:E(p),payload:{controls:t}}):Promise.reject(new d("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options.")),openPopover:t=>u?.features?.popovers!==!0?Promise.reject(new d("UNSUPPORTED","This host does not support popovers.")):rt(t)?k({...I,type:"popover-open",id:E(p),payload:t}):Promise.reject(new d("HOST_REJECTED","Popover requests need bounded geometry and JSON data.")),closePopover:Yt,setPopoverAnchorActive:Qt,onResolve:t=>(pe=t,()=>{pe===t&&(pe=null)}),toast:t=>{let o=t.message.trim();return!o||o.length>Ce?Promise.reject(new d("HOST_REJECTED",`Toast message must contain 1 to ${Ce} characters.`)):t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>Ue)?Promise.reject(new d("HOST_REJECTED",`Toast copy text must contain 1 to ${Ue} characters.`)):k({channel:_,v:1,type:"toast",id:E(p),payload:{...t,message:o}})},openUrl:t=>k({channel:_,v:1,type:"open-url",id:E(p),payload:{url:t}}),...To(k,()=>E(p),t=>Promise.reject(new d("HOST_REJECTED",t))),answerBlock:t=>k({channel:_,v:1,type:"block-answer",id:E(p),payload:{text:t.trim().slice(0,it)}}),openSurface:t=>k({channel:_,v:1,type:"open-surface",id:E(p),payload:{surfaceId:t}}),writeClipboard:t=>k({channel:_,v:1,type:"clipboard-write",id:E(p),payload:{text:t}}),compose:t=>k({channel:_,v:1,type:"compose",id:E(p),payload:t}),attach:t=>k({channel:_,v:1,type:"attach",id:E(p),payload:ie(t)}),startSession:async t=>{t.projectId!==void 0&&F(t.projectId);let o=t.worktree;o&&o!==!0&&(o.kind==="existing"?F(o.directory):(o.name!==void 0&&F(o.name,200),o.baseBranch!==void 0&&F(o.baseBranch,200)));let l=await C({channel:_,v:1,type:"start-session",id:E(p),payload:pt(t)},e.requestTimeoutMs??18e4);if(!at(l))throw new d("HOST_REJECTED","Host did not return a session.");return l},prompt:t=>C({channel:_,v:1,type:"prompt",id:E(p),payload:Et(t)}).then(o=>{if(!ct(o))throw new d("HOST_REJECTED","Host did not return a prompt result.");return o}),sessionLink:t=>k({channel:_,v:1,type:"session-link",id:E(p),payload:ie(t)}),close:()=>k({channel:_,v:1,type:"close",id:E(p)}),oauthStart:()=>k({channel:_,v:1,type:"oauth-start",id:E(p)}),oauthDisconnect:()=>k({channel:_,v:1,type:"oauth-disconnect",id:E(p)}),request:t=>(Le(t.path)?C({channel:_,v:1,type:"request",id:E(p),payload:t}):Po()).then(o=>{if(!Pe(o))throw new d("HOST_REJECTED","Host request result was empty.");return o}),serviceRequest:t=>(Le(t.path)?C({channel:_,v:1,type:"service-request",id:E(p),payload:t}):Po()).then(o=>{if(!Pe(o))throw new d("HOST_REJECTED","Host service request result was empty.");return o}),serviceStatus:()=>C({channel:_,v:1,type:"service-status",id:E(p)}).then(t=>{if(!St(t))throw new d("HOST_REJECTED","Host did not return service status.");return t}),readFile:t=>(ae(t)?C({channel:_,v:1,type:"file-read",id:E(p),payload:{path:t}}):we()).then(o=>{if(!ft(o))throw new d("HOST_REJECTED","Host did not return file content.");return o}),writeFile:(t,o)=>ae(t)?o.length>ye?Promise.reject(new d("FILE_TOO_LARGE",`Content is over ${ye} characters.`)):C({channel:_,v:1,type:"file-write",id:E(p),payload:{path:t,content:o}}).then(l=>{if(!At(l))throw new d("HOST_REJECTED","Host did not confirm the write.");return l}):we(),listDir:t=>(ae(t)?C({channel:_,v:1,type:"file-list",id:E(p),payload:{path:t}}):we()).then(o=>{if(!Ot(o))throw new d("HOST_REJECTED","Host did not return directory entries.");return o}),stat:t=>(ae(t)?C({channel:_,v:1,type:"file-stat",id:E(p),payload:{path:t}}):we()).then(o=>{if(!Rt(o))throw new d("HOST_REJECTED","Host did not return file status.");return o}),generate:t=>{let o=t.prompt.trim(),l=t.system?.trim();if(o.length===0||o.length>Ne)return Promise.reject(new d("HOST_REJECTED",`Prompt must be 1 to ${Ne} characters.`));if(l!==void 0&&(l.length===0||l.length>ve))return Promise.reject(new d("HOST_REJECTED",`System prompt must be 1 to ${ve} characters.`));let c=t.maxOutputTokens===void 0?void 0:Math.min(dt,Math.max(1,Math.floor(t.maxOutputTokens)));if(c!==void 0&&!Number.isFinite(c))return Promise.reject(new d("HOST_REJECTED","maxOutputTokens must be a number."));let f={prompt:o};return l!==void 0&&(f.system=l),c!==void 0&&(f.maxOutputTokens=c),C({channel:_,v:1,type:"generate",id:E(p),payload:f},e.requestTimeoutMs??ut).then(A=>{if(!ht(A))throw new d("HOST_REJECTED","Host did not return generated text.");return A})},onLateGenerateResult:t=>{ee.add(t);for(let o of je.splice(0))O([t],o);return Ft(),()=>{ee.delete(t)}},openMicrophone:rr,setBadge:t=>k({channel:_,v:1,type:"badge",id:E(p),payload:{count:_t(t)}}),setHeight:t=>k({channel:_,v:1,type:"resize",id:E(p),payload:{height:Tt(t)}}),onFileOpen:t=>(me.add(t),ze||(ze=!0,r.addEventListener("keydown",Wt,!0)),Te&&t(Te),()=>{me.delete(t)}),onFileSnapshot:t=>(_e=t,()=>{_e===t&&(_e=null)}),onFileSaved:t=>(ge.add(t),()=>{ge.delete(t)}),reportFileChange:t=>qe({...I,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:Kt,reportFileUnsupported:()=>qe({...I,type:"file-unsupported"}),dispose:()=>{for(let t of oe.keys())M({...I,type:"workspace-unsubscribe",id:E(p),payload:{subscriptionId:t}});oe.clear();for(let t of re.keys())M({...I,type:"shells-unsubscribe",id:E(p),payload:{subscriptionId:t}});re.clear(),D&&(Je(),D.release(),D=null),V=!0,pe=null,Ee=null,_e=null,me.clear(),ge.clear(),ze&&r.removeEventListener("keydown",Wt,!0),r.removeEventListener("message",Bt),r.removeEventListener("keydown",jt,!0),r.removeEventListener("pointerover",xe),r.removeEventListener("pointermove",xe),r.removeEventListener("pointerout",zt),r.removeEventListener("focus",qt),r.removeEventListener("blur",Jt);for(let t of te.values())clearTimeout(t.timer),t.reject(new d("HOST_UNAVAILABLE","Host client was disposed."));te.clear(),i.clear(),S.clear(),g.clear(),m.clear(),P.clear(),w.clear(),H.clear(),q.clear(),J.clear(),$.clear(),he.clear(),ee.clear(),je.length=0}}};var $o=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var An=new Set($o);var Sr=10*6e4;var fr=10*6e4;var Ar=10*6e4;var Or=10*6e4;var Vo=["none","agent","user"];var Rn=new Set(Vo);var Rr=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],hr=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],Fo=(e,r)=>{r.style.colorScheme=e.mode;for(let[n,a]of Rr)r.style.setProperty(n,e.tokens[a]);for(let[n,a,i]of hr){let S=e.tokens[i]??"";r.style.setProperty(n,S),r.style.setProperty(a,S)}r.style.setProperty("font-family",e.tokens.font),r.style.setProperty("font-size",e.tokens.fontSize??"0.875rem"),r.style.setProperty("line-height","1.45"),r.style.setProperty("color",e.tokens.foreground)},Ct=(e,r)=>{Fo(e.theme,r),r.dataset&&(r.dataset.ocSurface=e.surface,r.dataset.ocTheme=e.theme.mode)};var mr={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},h=(e,r)=>`var(--${e}, var(--oc-${mr[e]}, ${r}))`,j=h("surface-background","transparent"),He=h("surface-elevated","transparent"),ce=h("surface-elevated-foreground","inherit"),G=h("surface-foreground","inherit"),x=h("surface-muted-foreground","gray"),gr=h("surface-muted","transparent"),Y=h("interactive-border","currentColor"),y=h("interactive-hover","transparent"),Q=h("interactive-active","transparent"),Ut=h("interactive-selection","transparent"),Mt=h("interactive-selection-foreground","inherit"),W=h("primary","currentColor"),yt=h("primary-text","inherit"),Nt=h("error-text","inherit"),Ir=h("font-sans","inherit"),vt=h("font-mono","monospace"),jo=h("radius","9px"),Lt=`calc(${jo} - 2px)`,Bo=`calc(${jo} - 4px)`,b=(e,r,n="transparent")=>`color-mix(in srgb, ${e} ${r}%, ${n})`,Ko=`background-image: linear-gradient(${y}, ${y});`,Pt=(e,r="0.5px")=>`box-shadow: inset 0 0 0 ${r} ${e}, var(--oc-sdk-field-lift);`,wt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",Wo="box-shadow: var(--oc-sdk-lit);",Dt=`inset 0 0.5px 0 0 ${b(G,8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`,xr=`
:root {
  --oc-sdk-edge: ${b(G,16)};
  --oc-sdk-field-bg: ${He};
  --oc-sdk-raised-bg: ${j};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${b(G,14)};
  --oc-sdk-field-bg: ${b(j,50,He)};
  --oc-sdk-raised-bg: ${He};
  --oc-sdk-field-lift: ${Dt};
  --oc-sdk-raised-lift: ${Dt};
  --oc-sdk-lit: ${Dt};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`,Ge=e=>{let r=h(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${r}; --oc-sdk-tone-text: ${h(`${e}-text`,"inherit")}; }`},s=e=>`calc(${e}rem / 14)`,br=`
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${s(8)}; height: ${s(32)}; padding: 0 ${s(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${s(6)}; height: ${s(28)}; padding: 0 ${s(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${s(4)}; height: ${s(24)}; padding: 0 ${s(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${s(14)}; height: ${s(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${s(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${s(32)}; padding: 0 ${s(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${s(8)} ${s(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${s(34)}; padding-right: ${s(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${s(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${s(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${s(24)}; height: ${s(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${s(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${s(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${s(28)}; padding: 0 ${s(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${s(2)}; min-width: ${s(160)}; max-width: calc(100vw - ${s(16)}); max-height: min(${s(320)}, calc(100vh - ${s(16)})); overflow: auto; padding: ${s(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${s(2)} ${s(2)} ${s(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${s(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${s(8)}; width: 100%; padding: ${s(6)} ${s(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${s(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${s(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${s(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${s(14)}; height: ${s(14)}; margin-top: ${s(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${s(36)}; height: ${s(20)}; --oc-sdk-thumb-travel: ${s(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${s(2)}; left: ${s(2)}; width: ${s(16)}; height: ${s(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${s(2)}; padding: ${s(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${s(6)}; height: ${s(28)}; padding: 0 ${s(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${s(1)} ${s(6)}; font-size: ${s(11)}; font-weight: 500; line-height: ${s(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${s(8)}; width: 100%; padding: ${s(6)} ${s(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${s(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${s(16)} ${s(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${s(4)}; padding: ${s(40)} ${s(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${s(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${s(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${s(16)}; height: ${s(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${s(12)}; height: ${s(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${s(12)}; padding: ${s(8)} ${s(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${s(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${s(8)}; width: 100%; margin: ${s(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${s(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${s(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${s(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${s(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${s(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${s(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${s(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${s(36)}; height: ${s(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${s(44)}; }
  .oc-sdk-check { min-height: ${s(36)}; padding: ${s(8)} 0; }
}
`,zo=`${xr}
.oc-sdk { color: ${G}; font-family: ${Ir}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${Ko} }
.oc-sdk-mono { font-family: ${vt}; }
.oc-sdk-muted { color: ${x}; }
${Ge("success")}${Ge("warning")}${Ge("error")}${Ge("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${W}; --oc-sdk-tone-text: ${yt}; }

.oc-sdk-btn { border-radius: ${Lt}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${Bo}; }
.oc-sdk-btn[data-variant="default"] { color: ${yt}; background: ${b(W,10,j)}; border-color: ${b(W,12)}; ${Wo} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${b(W,16,j)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${b(W,22,j)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${gr}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${Q}, ${Q}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${ce}; ${wt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${Q}, ${Q}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${y}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${Q}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${h("status-error","red")}; color: ${Nt}; background: ${b("var(--oc-sdk-tone)",7,j)}; border-color: ${b("var(--oc-sdk-tone)",12)}; ${Wo} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${b("var(--oc-sdk-tone)",9,j)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${b("var(--oc-sdk-tone)",11,j)}; box-shadow: none; }

.oc-sdk-field-note { color: ${x}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${Nt}; }
.oc-sdk-input { border-radius: ${Lt}; background: var(--oc-sdk-field-bg); color: ${ce}; ${Pt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${x}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${Pt(b(G,26),"1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${Pt(h("status-error","red"),"1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${vt}; }

.oc-sdk-search-icon { color: ${x}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${W}; }
.oc-sdk-search-clear { border-radius: ${Bo}; color: ${x}; }
.oc-sdk-search-clear:hover { background: ${y}; color: ${G}; }

.oc-sdk-trigger { border-radius: ${Lt}; background: var(--oc-sdk-raised-bg); color: ${ce}; ${wt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${Q}, ${Q}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${x}; }
.oc-sdk-trigger-chevron { color: ${x}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${ce}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${He}; background-clip: padding-box; color: ${ce}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${y}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${Ut}; color: ${Mt}; }
.oc-sdk-option-check { color: ${G}; }
.oc-sdk-option[data-destructive="true"] { color: ${Nt}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${b(h("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${x}; }
.oc-sdk-popup-empty { color: ${x}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${Y}; border-radius: 4px; color: ${G}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${b(G,60,Y)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${Y}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${j}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${W}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${Ko} }
.oc-sdk-check-desc { color: ${x}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${b(G,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${x}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${G}; }
.oc-sdk-tab[aria-selected="true"] { color: ${Mt}; background: ${Ut}; border-color: ${Y}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${ce}; background: var(--oc-sdk-raised-bg); ${wt} }
.oc-sdk-tab-count { color: ${x}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${b(G,6)}; color: ${x}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${b("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${y}; }
.oc-sdk-row[aria-selected="true"] { background: ${Ut}; color: ${Mt}; }
.oc-sdk-row-lead { font-family: ${vt}; color: ${x}; }
.oc-sdk-row-sub { color: ${x}; }
.oc-sdk-row-meta { color: ${x}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${x}; }

.oc-sdk-empty-body { color: ${x}; }

.oc-sdk-spinner { color: ${x}; }
.oc-sdk-spinner-ring { border-color: ${Y}; border-top-color: ${W}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${b("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${x}; }

.oc-sdk-separator { color: ${x}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${b(Y,40)}; }

.oc-sdk-progress-label { color: ${x}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${b(G,6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${W}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${h("status-success","currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${h("success-text","inherit")}; }

.oc-sdk-text a { color: ${yt}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${b(Y,60)}; }
`,U=`
${Ze}
${br}
${zo}`;var Ke=kt(),Jo=document.querySelector("#directory"),qo=document.querySelector("#notice"),Z=document.querySelector("#hosts"),de=document.querySelector("#hosts-config"),ue=document.querySelector("#project-config"),Ht=document.querySelector("#result"),yr=document.querySelector("#reload"),Nr=document.querySelector("#save"),L=null,Be=0,Re=null,We=new Map;function B(e,r="info"){qo.className=r==="error"?"error":r==="success"?"ok":r==="warning"?"warning":"",qo.textContent=e}function vr(e){Ht.hidden=!1,Ht.textContent=typeof e=="string"?e:JSON.stringify(e,null,2)}function Yo(e,r){let n;try{n=JSON.parse(e)}catch(a){throw new Error(`${r} is not valid JSON: ${a instanceof Error?a.message:String(a)}`)}if(!n||typeof n!="object"||Array.isArray(n))throw new Error(`${r} must be a JSON object.`);return n}async function Qo(e,r){if(!L)throw new Error("Open a project first.");let n=await Ke.serviceRequest({method:"POST",path:e,body:JSON.stringify({...r,directory:L})}),a=JSON.parse(n.body||"{}");if(n.status<200||n.status>=300||a.ok===!1)throw new Error(a.error?.message??`Fleet service returned HTTP ${n.status}`);return a.result??a}async function Lr(e){let r=await Ke.serviceRequest({method:"GET",path:`/config?directory=${encodeURIComponent(e)}`,body:""}),n=JSON.parse(r.body||"{}");if(r.status<200||r.status>=300||n.ok===!1||!n.result)throw new Error(n.error?.message??`Fleet service returned HTTP ${r.status}`);return n.result}function Pr(e){let r=Yo(e,"Host registry");if(!r.hosts||typeof r.hosts!="object"||Array.isArray(r.hosts))throw new Error("Host registry needs a hosts object.");return r}function wr(e){let r=Yo(e,"Project configuration");if(typeof r.name!="string"||!r.name)throw new Error("Project configuration needs a name.");if(r.hosts!==void 0&&!Array.isArray(r.hosts))throw new Error("Project hosts must be an array when present; omit it to use every host.");if(r.requires!==void 0&&!Array.isArray(r.requires))throw new Error("Project requires must be an array of host tags when present.");return r}function Zo(e){let r=Object.keys(e.hosts.hosts??{}),n=e.project.hosts??r,a=e.project.requires??[];return n.filter(i=>{let S=e.hosts.hosts?.[i]?.tags??[];return a.every(g=>S.includes(g))})}function Dr(e){return e.project.hosts??Zo(e)}function er(e,r){let n=e.hosts.hosts?.[r];if(!n)return"missing from host registry";let i=(e.project.requires??[]).filter(S=>!(n.tags??[]).includes(S));return i.length>0?`does not satisfy requires: ${i.join(", ")}`:null}function Gr(e){if(Z.replaceChildren(),Object.keys(e.hosts.hosts??{}).length===0){let a=document.createElement("p");a.textContent="No hosts in the global registry yet.",Z.append(a);return}let n=Dr(e);if(n.length===0){let a=document.createElement("p");a.textContent=e.project.hosts!==void 0?"project.hosts is an empty allowlist. Omit it to use every registry host.":`No host matches project.requires: ${(e.project.requires??[]).join(", ")||"(none)"}.`,Z.append(a);return}for(let a of n){let i=e.hosts.hosts?.[a],S=er(e,a),g=document.createElement("div");g.className="host";let m=document.createElement("div");m.className="row";let P=document.createElement("strong");P.textContent=a;let w=document.createElement("small");w.textContent=i?`${i.ssh}${i.tags&&i.tags.length>0?` \xB7 ${i.tags.join(", ")}`:""}${S?` \xB7 ${S}`:""}`:S??"missing from host registry",m.append(P,w);let H=document.createElement("div");if(H.className="row",H.style.marginTop="8px",i)for(let[q,J]of[["Status","status"],["Plan","plan"],["Inspect recovery","recovery"]]){let $=document.createElement("button");$.textContent=q,$.dataset.action=J,$.dataset.host=a,H.append($)}g.append(m,H),Z.append(g)}}function tr(e,r){let n=We.get(r);Re=e.revision,de.value=n?.hosts??`${JSON.stringify(e.hosts,null,2)}
`,ue.value=n?.project??`${JSON.stringify(e.project,null,2)}
`,Gr(e);let a=Object.keys(e.hosts.hosts??{}).length,i=e.project.hosts,S=e.project.requires??[],g=Zo(e).length,m=(i??[]).filter($=>er(e,$)!==null).length,P=i===void 0?`all configured hosts (${g} eligible)`:`${g} of ${i.length} selected`,w=S.length>0?` \xB7 requires ${S.join(", ")}`:"",H=i!==void 0&&i.length===0?" \xB7 hosts is empty":m>0?` \xB7 ${m} need attention`:"",q=e.legacy?" Legacy fleet.json detected; saving migrates it to local configuration.":"",J=i!==void 0&&(i.length===0||m>0);B(`${a} host(s), ${P}${w}${H}.${q}`,J?"warning":"success")}async function Xt(){let e=L;if(!e)return;let r=++Be;B("Loading Fleet configuration\u2026");try{let n=await Lr(e);if(L!==e||r!==Be)return;tr(n,e)}catch(n){if(L!==e||r!==Be)return;Re=null;let a=We.get(e);de.value=a?.hosts??"",ue.value=a?.project??"",Z.replaceChildren(),n instanceof d&&/not found/i.test(n.message)?B("No local Fleet project configuration yet. Add a host and save.","warning"):B(n instanceof Error?n.message:String(n),"error")}}Ke.onReady(e=>{Ct(e,document.documentElement),L=e.directory,Jo.textContent=L??"Open a project to configure Fleet.",L&&Xt()});Ke.onDirectory(e=>{Be+=1,L=e,Jo.textContent=e??"Open a project to configure Fleet.",Ht.hidden=!0,e?Xt():(Re=null,de.value="",ue.value="",Z.replaceChildren())});function or(){L&&We.set(L,{hosts:de.value,project:ue.value})}de.addEventListener("input",or);ue.addEventListener("input",or);yr.addEventListener("click",()=>void Xt());Nr.addEventListener("click",()=>{(async()=>{let e=L;if(!e){B("Open a project first.","error");return}try{let r=Pr(de.value),n=wr(ue.value),a=await Qo("/config",{hosts:r,project:n,...Re?{revision:Re}:{}});if(L!==e)return;We.delete(e),tr(a,e),B("Local Fleet configuration saved. Nothing was written to the repository.","success")}catch(r){if(L!==e)return;B(r instanceof Error?r.message:String(r),"error")}})()});Z.addEventListener("click",e=>{let r=e.target.closest("button[data-action]");if(!r)return;let n=r.dataset.action,a=r.dataset.host;!n||!a||(r.disabled=!0,B(`${n} on ${a}\u2026`),(async()=>{try{vr(await Qo(n==="status"?"/status":n==="plan"?"/plan":"/recovery",{host:a})),B(`${n} completed.`,"success")}catch(i){B(i instanceof Error?i.message:String(i),"error")}finally{r.disabled=!1}})())});})();
