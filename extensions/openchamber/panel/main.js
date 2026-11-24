"use strict";(()=>{var _="openchamber.sdk";var be="data-oc-scrolling",Qe=`
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
:hover, [${be}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${be}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${be}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${be}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function Qt(e){let r=e.documentElement;if(r.hasAttribute("data-oc-scrollbar-activity"))return;r.setAttribute("data-oc-scrollbar-activity","");let n=new WeakMap;e.addEventListener("scroll",d=>{let p=d.target===e?r:d.target;if(!(p instanceof Element))return;p.hasAttribute("data-oc-scrolling")||p.setAttribute("data-oc-scrolling","");let A=n.get(p);A!==void 0&&clearTimeout(A),n.set(p,setTimeout(()=>{n.delete(p),p.removeAttribute("data-oc-scrolling")},1e3))},{capture:!0,passive:!0})}var or=`(${Qt.toString()})(document);`;var Zt=e=>{let r=[],n=0,d=0;return{push:p=>{for(r.push(p),d+=p.length;d-n>e&&r.length>1;){let A=r.shift();d-=A?.length??0,n=0}},pull:p=>{let A=0;for(;A<p.length&&r.length>0;){let k=r[0],b=Math.min(p.length-A,k.length-n);p.set(k.subarray(n,n+b),A),A+=b,n+=b,n>=k.length&&(r.shift(),d-=k.length,n=0)}p.fill(0,A)},clear:()=>{r.length=0,n=0,d=0},get size(){return d-n}}};var ro=/^[a-z][a-z0-9-]{0,39}$/;var eo=e=>Object(e)===e&&!Array.isArray(e),Ze=(e,r)=>Object.keys(e).every(n=>r.includes(n)),to=e=>String(e)===e&&e.length>=1&&e.length<=60,oo=e=>String(e)===e&&e.length>=1&&e.length<=80,no=e=>{if(!Array.isArray(e)||e.length>4)return!1;let r=new Set;for(let n of e){if(!eo(n)||!ro.test(n.id)||!to(n.label)||n.disabled!==void 0&&n.disabled!==!0&&n.disabled!==!1||r.has(n.id))return!1;if(r.add(n.id),n.kind==="button"){if(!Ze(n,["kind","id","label","disabled"]))return!1;continue}if(n.kind!=="select"||!Ze(n,["kind","id","label","value","options","disabled"])||!oo(n.value)||!Array.isArray(n.options)||n.options.length<1||n.options.length>16)return!1;let d=new Set;for(let p of n.options){if(!eo(p)||!Ze(p,["value","label"])||!oo(p.value)||!to(p.label)||d.has(p.value))return!1;d.add(p.value)}if(!d.has(n.value))return!1}return!0};var nr=1024*1024;var so=["{id}","{segment}","{segments+}"];var Kr=new Set(so);var io=["turn-finished","turn-failed","permission-asked","question-asked","turn-started","session-created","session-archived","session-deleted"];var jr=new Set(io);var et=e=>"bytes"in e?e.bytes.byteLength:e.content.length,ao=(e,r)=>{if(e.path!==r.path||e.readOnly!==r.readOnly)return!1;if(e.encoding==="text"||r.encoding==="text")return e.encoding==="text"&&r.encoding==="text"&&e.content===r.content;if(e.bytes.byteLength!==r.bytes.byteLength)return!1;for(let n=0;n<e.bytes.byteLength;n+=1)if(e.bytes[n]!==r.bytes[n])return!1;return!0};var co=/^[A-Za-z0-9_-]{1,80}$/;var lo=["left","right","top","bottom"];var po=(e,r=0,n={remaining:16e3})=>{if(--n.remaining<0||r>=32)return!1;if(e===null)return!0;let d=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let p of d)if(!po(p,r+1,n))return!1;return!0},tt=e=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every(r=>/^(0|[1-9]\d*)$/.test(r)&&Number(r)<e.length)&&e.every(tt);if(Object(e)===e){let r=Object.getPrototypeOf(e);return(r===null||r===Object.prototype)&&Object.values(e).every(tt)}return String(e)===e||Number.isFinite(e)},ot=e=>{try{return String(e.id)!==e.id||!co.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!lo.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!po(e.data)||!tt(e.data)?!1:JSON.stringify(e.data).length<=16e3}catch{return!1}};var uo=/^[0-9a-f]{7,64}$/i,Eo=e=>uo.test(e),rt=255,_o=(e,r,n)=>({openCommit:d=>Eo(d)?e({channel:_,v:1,type:"open-commit",id:r(),payload:{sha:d}}):n("Commit id must be 7 to 64 hex characters."),openWalkthrough:({base:d})=>{let p=d.trim();return!p||p.length>rt?n(`Base must contain 1 to ${rt} characters.`):e({channel:_,v:1,type:"open-walkthrough",id:r(),payload:{base:p}})}});var st=2e3;var So=["file","directory","other","missing"],it=e=>!!(e&&"sessionId"in e),at=e=>!!(e&&"sent"in e&&!("sessionId"in e));var ke=500,Ce=32e3,fo=16e3,Ao=128,Oo=200,Ro=2e3,ho=16e3,mo=80,Io=200,go=16e3;var xo=2e3;var ct=2e4,Ue=1024,Me=2e6;var ye=64e3,Ne=8e3,dt=4e3;var lt=96e4,sr=60*6e4;var bo=999,ko=1e4,Se=500,Co=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],Uo=["stopped","starting","ready","failed"],ir=new Set(Co),Mo=e=>ir.has(e),yo=e=>e&&Mo(e)?e:"HOST_REJECTED",oe=e=>e===void 0?!1:e===null||e===!0||e===!1||String(e)===e?!0:Number(e)===e?Number.isFinite(e):Array.isArray(e)?e.every(oe):Object(e)===e?Object.values(e).every(oe):!1,No=e=>oe(e)&&JSON.stringify(e).length<=go,To=e=>e?.trim().slice(0,Io)??"",re=e=>{let r=e.id.trim().slice(0,Ao),n=e.title.trim().slice(0,Oo),d=e.url.trim().slice(0,Ro),p=e.text?.trim().slice(0,ho),A=e.author?.trim().slice(0,mo),k=e.kind==="pull"?"pull":"issue",b={providerId:e.providerId.trim(),id:r,title:n||r,url:d,kind:k};if(p&&(b.text=p),A&&(b.author=A),k==="pull"){let P=To(e.branches?.head),$=To(e.branches?.base);P&&$&&(b.branches={head:P,base:$})}return No(e.data)&&(b.data=e.data),b},pt=e=>{let r=re(e);return e.projectId&&(r.projectId=e.projectId),e.navigation&&(r.navigation=e.navigation),e.worktree&&(r.worktree=e.worktree),r},ut=e=>{let r={text:e.text.trim().slice(0,fo)};return e.send&&(r.send=!0),r},Et=e=>e===null||!Number.isFinite(e)?null:Math.min(bo,Math.max(0,Math.round(e))),_t=e=>Number.isFinite(e)?Math.min(ko,Math.max(0,Math.ceil(e))):0;var ne=e=>e.length>0&&e.length<=Ue&&!e.includes("\0")&&!e.includes("\\");var ve=e=>!e.startsWith("/")||e.includes("\0")||e.includes("\\")||e.includes("://")||e.length>xo?!1:!e.split("/").some(n=>n==="."||n===".."),ar=new Set(Uo),Tt=e=>!!(e&&"status"in e&&ar.has(String(e.status))&&!("body"in e)),Le=e=>!!(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),St=e=>!!(e&&"content"in e&&String(e.content)===e.content),ft=e=>!!(e&&"written"in e&&e.written===!0),At=e=>!!(e&&"entries"in e&&Array.isArray(e.entries)),cr=new Set(So),Ot=e=>!!(e&&"kind"in e&&"size"in e&&cr.has(String(e.kind))&&Number.isFinite(e.size)),Rt=e=>!!(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),dr=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","service-event","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late","microphone-audio","microphone-ended"]),lr=e=>Object(e)===e?e:null,nt=e=>String(e)===e&&e.length>0,pr=e=>{if(!nt(e.id))return null;if(e.ok===!0){let r={channel:_,v:1,type:"result",id:e.id,ok:!0};return Object(e.payload)===e.payload&&(r.payload=e.payload),r}return e.ok===!1&&nt(e.error)?{channel:_,v:1,type:"result",id:e.id,ok:!1,error:e.error,code:yo(nt(e.code)?e.code:void 0)}:null},ht=e=>{let r=lr(e);return!r||r.channel!==_||r.v!==1?null:r.type==="result"?pr(r):!dr.has(String(r.type))||Object(r.payload)!==r.payload?null:r};var vo=e=>"key"in e&&"metaKey"in e&&"ctrlKey"in e,ur=e=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s",c=class extends Error{code;constructor(r,n){super(n),this.name="HostRequestError",this.code=r}},Lo=()=>Promise.reject(new c("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),Pe=()=>Promise.reject(new c("BAD_PATH",`File path must be 1 to ${Ue} characters without NUL or backslash.`)),we=e=>{if(e!==void 0){if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new c("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0}},E=e=>(e.value+=1,`oc-${e.value}`),bt=(e={})=>{let r=e.target??("window"in globalThis?window:null);if(!r)throw new c("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let n=e.acceptSource??(t=>t===r.parent),d=e.requestTimeoutMs??ct,p=new Set,A=new Set,k=new Set,b=new Set,P=new Set,$=new Set,z=new Set,F=new Set,Ae=new Set,Oe=new Set,Re=new Set,Y=new Set,We=[],le=null,pe=null,he=new Set,me=new Set,ue=null,Ee=null,je=!1,Q=new Map,Z=new Map,ee=new Map,H=!1,u={value:0},l=null,B=null,_e=!1,Te=!1,Xt=null,w=null,$t=t=>t?{sessionId:t.id,phase:t.busy?"started":"completed"}:null,M=t=>{r.parent.postMessage(t,"*")},Vt=()=>{H||r.parent===r||Y.size===0||l?.features?.lateGenerateResults!==!0||M({channel:_,v:1,type:"generate-late-listen"})},O=(t,o)=>{for(let a of t)try{a(o)}catch(i){console.error(i)}},Ft=t=>{if(!(t instanceof MessageEvent)||!n(t.source))return;let o=ht(t.data);if(!o)return;if(o.type==="workspace"){let i=Z.get(o.payload.subscriptionId);i&&O([i],o.payload.snapshot);return}if(o.type==="shells"){let i=ee.get(o.payload.subscriptionId);i&&O([i],o.payload.snapshot);return}if(o.type==="microphone-audio"){w?.queue.push(o.payload.samples);return}if(o.type==="microphone-ended"){let i=w;if(!i)return;w=null,i.release(),O(i.endedListeners,o.payload.reason);return}if(o.type==="ready"){l=o.payload,B=$t(o.payload.session),O(p,o.payload),O(A,o.payload.directory),O(k,o.payload.session),B&&O(b,B),O(P,o.payload.connection),O($,o.payload.settings),O(z,o.payload.item),o.payload.block&&O(F,o.payload.block),Vt();return}if(o.type==="service-event"){O(Ae,o.payload);return}if(o.type==="generate-late"){Y.size===0?We.push(o.payload):O(Y,o.payload);return}if(o.type==="directory"){l&&(l={...l,directory:o.payload.directory}),O(A,o.payload.directory);return}if(o.type==="session"){l&&(l={...l,session:o.payload.session}),o.payload.session?B?.sessionId!==o.payload.session.id&&(B=$t(o.payload.session)):B=null,O(k,o.payload.session);return}if(o.type==="session-lifecycle"){B=o.payload,O(b,o.payload);return}if(o.type==="connection"){l&&(l={...l,connection:o.payload.connection}),O(P,o.payload.connection);return}if(o.type==="settings"){l&&(l={...l,settings:o.payload.settings}),O($,o.payload.settings);return}if(o.type==="item"){l&&(l={...l,item:o.payload.item}),O(z,o.payload.item);return}if(o.type==="status-control-event"){O(Oe,o.payload);return}if(o.type==="popover-closed"){O(Re,o.payload);return}if(o.type==="action"){let i=f=>{H||M({channel:_,v:1,type:"action-result",id:o.id,payload:f})},S=pe;if(!S){i({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>S(o.payload)).then(()=>i({ok:!0}),f=>{let R=(f instanceof Error?f.message:String(f)).trim();i({ok:!1,error:(R||"Action failed.").slice(0,Se)})});return}if(o.type==="file-open"){let i=o.payload;if(Ee&&ao(Ee,i))return;Ee=i,O(he,o.payload);return}if(o.type==="file-saved"){O(me,o.payload.version);return}if(o.type==="file-snapshot"){let i=R=>{H||M({channel:_,v:1,type:"file-snapshot-result",id:o.id,payload:R})},S=R=>i({error:(R.trim()||"Could not read the edited file.").slice(0,Se)}),f=ue;if(!f){S("This extension does not edit files.");return}Promise.resolve().then(()=>f(o.payload.purpose)).then(R=>{if(et(R)>2e7){S(`The file is over ${2e7} ${"bytes"in R?"bytes":"characters"}.`);return}if(R.version.length>256){S(`The snapshot version is over ${256} characters.`);return}i({snapshot:"bytes"in R?{bytes:R.bytes,version:R.version}:{content:R.content,version:R.version}})},R=>S(R instanceof Error?R.message:String(R)));return}if(o.type==="resolve"){let i=f=>{M({channel:_,v:1,type:"resolve-result",id:o.id,payload:f})},S=le;if(!S){i({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>S(o.payload)).then(f=>i({item:f?re(f):null}),f=>{let R=(f instanceof Error?f.message:String(f)).trim();i({error:(R||"Command failed.").slice(0,Se)})});return}let a=Q.get(o.id);if(a){if(clearTimeout(a.timer),Q.delete(o.id),o.ok){a.resolve(o.payload);return}a.reject(new c(o.code,o.error))}};r.addEventListener("message",Ft),M({channel:_,v:1,type:"hello"});let C=(t,o=d)=>H||r.parent===r?Promise.reject(new c("HOST_UNAVAILABLE","No host frame. This page is not in an iframe.")):new Promise((a,i)=>{let S=setTimeout(()=>{Q.delete(t.id),i(new c("HOST_TIMEOUT","Host did not answer in time."))},o);Q.set(t.id,{resolve:a,reject:i,timer:S}),M(t)}),x=t=>C(t).then(()=>{}),m={channel:_,v:1},ze=t=>{!H&&r.parent!==r&&M(t)},Bt=()=>ze({...m,type:"file-save"}),qe=()=>{!H&&r.parent!==r&&M({...m,type:"microphone-close",id:E(u)})},er=async()=>{if(w)throw new c("HOST_REJECTED","The microphone is already open in this frame.");if(l?.features?.microphone!==!0)throw new c("UNSUPPORTED","This OpenChamber cannot share the microphone with extensions.");let t=globalThis.AudioContext;if(typeof t!="function")throw new c("UNSUPPORTED","This frame has no Web Audio.");let o=new t;if(o.sampleRate<8e3||o.sampleRate>192e3)throw o.close().catch(()=>{}),new c("UNSUPPORTED",`Audio at ${o.sampleRate} Hz is not supported.`);let a=o.state==="suspended"?o.resume().catch(()=>{}):void 0,i=Zt(Math.round(o.sampleRate/4)),S=o.createScriptProcessor(1024,1,1);S.onaudioprocess=G=>i.pull(G.outputBuffer.getChannelData(0));let f=o.createMediaStreamDestination();S.connect(f);let R=new Set,te={queue:i,endedListeners:R,release:()=>{S.onaudioprocess=null,S.disconnect(),i.clear();for(let G of f.stream.getTracks())G.stop();o.close().catch(()=>{})}};w=te;try{let G=await C({...m,type:"microphone-open",id:E(u),payload:{sampleRate:o.sampleRate}},12e4);if(!G||!("opened"in G)||G.opened!==!0)throw new c("HOST_REJECTED","Host did not open the microphone.");if(await a,w!==te)throw new c("DISCONNECTED","The microphone closed while it was opening.")}catch(G){throw w===te&&(w=null),te.release(),qe(),G}return{stream:f.stream,close:()=>{w===te&&(w=null,te.release(),qe())},onEnded:G=>(R.add(G),()=>{R.delete(G)})}},Kt=t=>{!vo(t)||!ur(t)||(t.preventDefault(),Bt())},Wt=t=>{!vo(t)||t.key!=="Escape"||l?.surface!=="popover"||!l.popover||(t.preventDefault(),Jt(l.popover.id,"escape").catch(()=>{}))},Ie=()=>{let t=l?.surface==="popover"?l.popover:void 0;if(!t)return;let o=_e||Te;Xt!==o&&(Xt=o,Yt(t.id,o).catch(()=>{}))},ge=()=>{l?.surface!=="popover"||_e||(_e=!0,Ie())},jt=t=>{l?.surface!=="popover"||t.relatedTarget!==null||!_e||(_e=!1,Ie())},zt=()=>{l?.surface!=="popover"||Te||(Te=!0,Ie())},qt=()=>{l?.surface!=="popover"||!Te||(Te=!1,Ie())},X=(t,o=1024)=>{if(!t.trim()||t.length>o)throw new c("HOST_REJECTED",`Identity must contain 1 to ${o} characters.`)},Je=async t=>{t.kind!=="projects"&&X(t.projectId);let o=await C({...m,type:"workspace-read",id:E(u),payload:t});if(!o||!("kind"in o)||!("state"in o)||o.kind!==t.kind)throw new c("HOST_REJECTED","Host did not return workspace data.");return o},Ye=async(t,o)=>{t.kind!=="projects"&&X(t.projectId);let a=E(u);Z.set(a,o);try{await x({...m,type:"workspace-subscribe",id:E(u),payload:{subscriptionId:a,query:t}})}catch(i){throw Z.delete(a),H||M({...m,type:"workspace-unsubscribe",id:E(u),payload:{subscriptionId:a}}),i}return()=>{!Z.delete(a)||H||M({...m,type:"workspace-unsubscribe",id:E(u),payload:{subscriptionId:a}})}},tr=async(t,o)=>{t.kind==="session"&&X(t.sessionId),t.kind==="project"&&X(t.projectId);let a=E(u);ee.set(a,o);try{await x({...m,type:"shells-subscribe",id:E(u),payload:{subscriptionId:a,scope:t}})}catch(i){throw ee.delete(a),H||M({...m,type:"shells-unsubscribe",id:E(u),payload:{subscriptionId:a}}),i}return()=>{!ee.delete(a)||H||M({...m,type:"shells-unsubscribe",id:E(u),payload:{subscriptionId:a}})}},xe=async t=>{if("key"in t&&(t.key.length===0||t.key.length>128))throw new c("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!oe(t.value))throw new c("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>65536)throw new c("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&l?.features?.deviceStorage!==!0)throw new c("UNSUPPORTED","This host does not support device storage.");let o=await C({...m,type:"storage",id:E(u),payload:t});if(!o||!("storage"in o)||o.op!==t.op)throw new c("HOST_REJECTED","Host did not return storage data.");return o},Jt=(t,o)=>l?.features?.popovers!==!0&&!(l?.surface==="popover"&&l.popover?.id===t)?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):x({...m,type:"popover-close",id:E(u),payload:o?{id:t,reason:o}:{id:t}}),Yt=(t,o)=>l?.features?.popovers!==!0&&!(l?.surface==="popover"&&l.popover?.id===t)?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):x({...m,type:"popover-anchor",id:E(u),payload:{id:t,active:o}});return r.addEventListener("keydown",Wt,!0),r.addEventListener("pointerover",ge),r.addEventListener("pointermove",ge),r.addEventListener("pointerout",jt),r.addEventListener("focus",zt),r.addEventListener("blur",qt),{onAction:t=>(pe=t,()=>{pe===t&&(pe=null)}),listProjects:async()=>{let t=await Je({kind:"projects"});if(t.kind!=="projects")throw new c("HOST_REJECTED","Expected projects.");return t},listWorktrees:async t=>{let o=await Je({kind:"worktrees",projectId:t});if(o.kind!=="worktrees")throw new c("HOST_REJECTED","Expected worktrees.");return o},listSessions:async t=>{let o=await Je({kind:"sessions",projectId:t});if(o.kind!=="sessions")throw new c("HOST_REJECTED","Expected sessions.");return o},onProjects:t=>Ye({kind:"projects"},o=>{o.kind==="projects"&&t(o)}),onWorktrees:(t,o)=>Ye({kind:"worktrees",projectId:t},a=>{a.kind==="worktrees"&&o(a)}),onSessions:(t,o)=>Ye({kind:"sessions",projectId:t},a=>{a.kind==="sessions"&&o(a)}),onRunningShells:(t,o)=>tr(t,o),readShellOutput:async(t,o)=>{X(t,128);let a=o?.cursor;if(a!==void 0&&(!Number.isInteger(a)||a<0))throw new c("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let i=o?.tailBytes;if(i!==void 0&&(!Number.isInteger(i)||i<1||i>65536))throw new c("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${65536}.`);let f=await C({...m,type:"shell-output",id:E(u),payload:{shellId:t,cursor:a,tailBytes:i}});if(!f||typeof f.output!="string"||!Number.isFinite(f.cursor))throw new c("HOST_REJECTED","Host did not return shell output.");return f},stopShell:async t=>{if(X(t,128),(await C({...m,type:"shell-stop",id:E(u),payload:{shellId:t}}))?.stopped!==!0)throw new c("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async t=>{X(t),await x({...m,type:"open-session",id:E(u),payload:{sessionId:t}})},storage:{get:async(t,o)=>{let a=we(o),i={op:"get",key:t};a&&(i.scope=a);let S=await xe(i);return S.op==="get"&&S.found?S.value:void 0},set:async(t,o,a)=>{let i=we(a),S={op:"set",key:t,value:o};i&&(S.scope=i),await xe(S)},delete:async(t,o)=>{let a=we(o),i={op:"delete",key:t};a&&(i.scope=a),await xe(i)},keys:async t=>{let o=we(t),a={op:"keys"};o&&(a.scope=o);let i=await xe(a);if(i.op!=="keys")throw new c("HOST_REJECTED","Expected storage keys.");return i.keys}},onReady:t=>(p.add(t),l&&t(l),()=>{p.delete(t)}),onDirectory:t=>(A.add(t),l&&t(l.directory),()=>{A.delete(t)}),onSession:t=>(k.add(t),l&&t(l.session),()=>{k.delete(t)}),onSessionLifecycle:t=>(b.add(t),B&&t(B),()=>{b.delete(t)}),onConnection:t=>(P.add(t),l&&t(l.connection),()=>{P.delete(t)}),onSettings:t=>($.add(t),l&&t(l.settings),()=>{$.delete(t)}),onItem:t=>(z.add(t),l&&t(l.item),()=>{z.delete(t)}),onBlock:t=>(F.add(t),l?.block&&t(l.block),()=>{F.delete(t)}),onServiceEvent:t=>(Ae.add(t),()=>{Ae.delete(t)}),onStatusControl:t=>(Oe.add(t),()=>{Oe.delete(t)}),onPopoverClosed:t=>(Re.add(t),()=>{Re.delete(t)}),setStatusControls:t=>l?.features?.statusControls!==!0?Promise.reject(new c("UNSUPPORTED","This host does not support status controls.")):no(t)?x({...m,type:"status-controls",id:E(u),payload:{controls:t}}):Promise.reject(new c("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options.")),openPopover:t=>l?.features?.popovers!==!0?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):ot(t)?x({...m,type:"popover-open",id:E(u),payload:t}):Promise.reject(new c("HOST_REJECTED","Popover requests need bounded geometry and JSON data.")),closePopover:Jt,setPopoverAnchorActive:Yt,onResolve:t=>(le=t,()=>{le===t&&(le=null)}),toast:t=>{let o=t.message.trim();return!o||o.length>ke?Promise.reject(new c("HOST_REJECTED",`Toast message must contain 1 to ${ke} characters.`)):t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>Ce)?Promise.reject(new c("HOST_REJECTED",`Toast copy text must contain 1 to ${Ce} characters.`)):x({channel:_,v:1,type:"toast",id:E(u),payload:{...t,message:o}})},openUrl:t=>x({channel:_,v:1,type:"open-url",id:E(u),payload:{url:t}}),..._o(x,()=>E(u),t=>Promise.reject(new c("HOST_REJECTED",t))),answerBlock:t=>x({channel:_,v:1,type:"block-answer",id:E(u),payload:{text:t.trim().slice(0,st)}}),openSurface:t=>x({channel:_,v:1,type:"open-surface",id:E(u),payload:{surfaceId:t}}),writeClipboard:t=>x({channel:_,v:1,type:"clipboard-write",id:E(u),payload:{text:t}}),compose:t=>x({channel:_,v:1,type:"compose",id:E(u),payload:t}),attach:t=>x({channel:_,v:1,type:"attach",id:E(u),payload:re(t)}),startSession:async t=>{t.projectId!==void 0&&X(t.projectId);let o=t.worktree;o&&o!==!0&&(o.kind==="existing"?X(o.directory):(o.name!==void 0&&X(o.name,200),o.baseBranch!==void 0&&X(o.baseBranch,200)));let a=await C({channel:_,v:1,type:"start-session",id:E(u),payload:pt(t)},e.requestTimeoutMs??18e4);if(!it(a))throw new c("HOST_REJECTED","Host did not return a session.");return a},prompt:t=>C({channel:_,v:1,type:"prompt",id:E(u),payload:ut(t)}).then(o=>{if(!at(o))throw new c("HOST_REJECTED","Host did not return a prompt result.");return o}),sessionLink:t=>x({channel:_,v:1,type:"session-link",id:E(u),payload:re(t)}),close:()=>x({channel:_,v:1,type:"close",id:E(u)}),oauthStart:()=>x({channel:_,v:1,type:"oauth-start",id:E(u)}),oauthDisconnect:()=>x({channel:_,v:1,type:"oauth-disconnect",id:E(u)}),request:t=>(ve(t.path)?C({channel:_,v:1,type:"request",id:E(u),payload:t}):Lo()).then(o=>{if(!Le(o))throw new c("HOST_REJECTED","Host request result was empty.");return o}),serviceRequest:t=>(ve(t.path)?C({channel:_,v:1,type:"service-request",id:E(u),payload:t}):Lo()).then(o=>{if(!Le(o))throw new c("HOST_REJECTED","Host service request result was empty.");return o}),serviceStatus:()=>C({channel:_,v:1,type:"service-status",id:E(u)}).then(t=>{if(!Tt(t))throw new c("HOST_REJECTED","Host did not return service status.");return t}),readFile:t=>(ne(t)?C({channel:_,v:1,type:"file-read",id:E(u),payload:{path:t}}):Pe()).then(o=>{if(!St(o))throw new c("HOST_REJECTED","Host did not return file content.");return o}),writeFile:(t,o)=>ne(t)?o.length>Me?Promise.reject(new c("FILE_TOO_LARGE",`Content is over ${Me} characters.`)):C({channel:_,v:1,type:"file-write",id:E(u),payload:{path:t,content:o}}).then(a=>{if(!ft(a))throw new c("HOST_REJECTED","Host did not confirm the write.");return a}):Pe(),listDir:t=>(ne(t)?C({channel:_,v:1,type:"file-list",id:E(u),payload:{path:t}}):Pe()).then(o=>{if(!At(o))throw new c("HOST_REJECTED","Host did not return directory entries.");return o}),stat:t=>(ne(t)?C({channel:_,v:1,type:"file-stat",id:E(u),payload:{path:t}}):Pe()).then(o=>{if(!Ot(o))throw new c("HOST_REJECTED","Host did not return file status.");return o}),generate:t=>{let o=t.prompt.trim(),a=t.system?.trim();if(o.length===0||o.length>ye)return Promise.reject(new c("HOST_REJECTED",`Prompt must be 1 to ${ye} characters.`));if(a!==void 0&&(a.length===0||a.length>Ne))return Promise.reject(new c("HOST_REJECTED",`System prompt must be 1 to ${Ne} characters.`));let i=t.maxOutputTokens===void 0?void 0:Math.min(dt,Math.max(1,Math.floor(t.maxOutputTokens)));if(i!==void 0&&!Number.isFinite(i))return Promise.reject(new c("HOST_REJECTED","maxOutputTokens must be a number."));let S={prompt:o};return a!==void 0&&(S.system=a),i!==void 0&&(S.maxOutputTokens=i),C({channel:_,v:1,type:"generate",id:E(u),payload:S},e.requestTimeoutMs??lt).then(f=>{if(!Rt(f))throw new c("HOST_REJECTED","Host did not return generated text.");return f})},onLateGenerateResult:t=>{Y.add(t);for(let o of We.splice(0))O([t],o);return Vt(),()=>{Y.delete(t)}},openMicrophone:er,setBadge:t=>x({channel:_,v:1,type:"badge",id:E(u),payload:{count:Et(t)}}),setHeight:t=>x({channel:_,v:1,type:"resize",id:E(u),payload:{height:_t(t)}}),onFileOpen:t=>(he.add(t),je||(je=!0,r.addEventListener("keydown",Kt,!0)),Ee&&t(Ee),()=>{he.delete(t)}),onFileSnapshot:t=>(ue=t,()=>{ue===t&&(ue=null)}),onFileSaved:t=>(me.add(t),()=>{me.delete(t)}),reportFileChange:t=>ze({...m,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:Bt,reportFileUnsupported:()=>ze({...m,type:"file-unsupported"}),dispose:()=>{for(let t of Z.keys())M({...m,type:"workspace-unsubscribe",id:E(u),payload:{subscriptionId:t}});Z.clear();for(let t of ee.keys())M({...m,type:"shells-unsubscribe",id:E(u),payload:{subscriptionId:t}});ee.clear(),w&&(qe(),w.release(),w=null),H=!0,le=null,pe=null,ue=null,he.clear(),me.clear(),je&&r.removeEventListener("keydown",Kt,!0),r.removeEventListener("message",Ft),r.removeEventListener("keydown",Wt,!0),r.removeEventListener("pointerover",ge),r.removeEventListener("pointermove",ge),r.removeEventListener("pointerout",jt),r.removeEventListener("focus",zt),r.removeEventListener("blur",qt);for(let t of Q.values())clearTimeout(t.timer),t.reject(new c("HOST_UNAVAILABLE","Host client was disposed."));Q.clear(),p.clear(),A.clear(),k.clear(),b.clear(),P.clear(),$.clear(),z.clear(),F.clear(),Ae.clear(),Oe.clear(),Re.clear(),Y.clear(),We.length=0}}};var Xo=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var _n=new Set(Xo);var Er=10*6e4;var _r=10*6e4;var Tr=10*6e4;var Sr=10*6e4;var $o=["none","agent","user"];var Sn=new Set($o);var fr=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],Ar=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],Vo=(e,r)=>{r.style.colorScheme=e.mode;for(let[n,d]of fr)r.style.setProperty(n,e.tokens[d]);for(let[n,d,p]of Ar){let A=e.tokens[p]??"";r.style.setProperty(n,A),r.style.setProperty(d,A)}r.style.setProperty("font-family",e.tokens.font),r.style.setProperty("font-size",e.tokens.fontSize??"0.875rem"),r.style.setProperty("line-height","1.45"),r.style.setProperty("color",e.tokens.foreground)},kt=(e,r)=>{Vo(e.theme,r),r.dataset&&(r.dataset.ocSurface=e.surface,r.dataset.ocTheme=e.theme.mode)};var Or={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},h=(e,r)=>`var(--${e}, var(--oc-${Or[e]}, ${r}))`,W=h("surface-background","transparent"),Ge=h("surface-elevated","transparent"),se=h("surface-elevated-foreground","inherit"),D=h("surface-foreground","inherit"),I=h("surface-muted-foreground","gray"),Rr=h("surface-muted","transparent"),q=h("interactive-border","currentColor"),y=h("interactive-hover","transparent"),J=h("interactive-active","transparent"),Ct=h("interactive-selection","transparent"),Ut=h("interactive-selection-foreground","inherit"),K=h("primary","currentColor"),Mt=h("primary-text","inherit"),yt=h("error-text","inherit"),hr=h("font-sans","inherit"),Nt=h("font-mono","monospace"),Wo=h("radius","9px"),vt=`calc(${Wo} - 2px)`,Fo=`calc(${Wo} - 4px)`,g=(e,r,n="transparent")=>`color-mix(in srgb, ${e} ${r}%, ${n})`,Bo=`background-image: linear-gradient(${y}, ${y});`,Lt=(e,r="0.5px")=>`box-shadow: inset 0 0 0 ${r} ${e}, var(--oc-sdk-field-lift);`,Pt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",Ko="box-shadow: var(--oc-sdk-lit);",wt=`inset 0 0.5px 0 0 ${g(D,8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`,mr=`
:root {
  --oc-sdk-edge: ${g(D,16)};
  --oc-sdk-field-bg: ${Ge};
  --oc-sdk-raised-bg: ${W};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${g(D,14)};
  --oc-sdk-field-bg: ${g(W,50,Ge)};
  --oc-sdk-raised-bg: ${Ge};
  --oc-sdk-field-lift: ${wt};
  --oc-sdk-raised-lift: ${wt};
  --oc-sdk-lit: ${wt};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`,De=e=>{let r=h(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${r}; --oc-sdk-tone-text: ${h(`${e}-text`,"inherit")}; }`},s=e=>`calc(${e}rem / 14)`,Ir=`
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
`,jo=`${mr}
.oc-sdk { color: ${D}; font-family: ${hr}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${Bo} }
.oc-sdk-mono { font-family: ${Nt}; }
.oc-sdk-muted { color: ${I}; }
${De("success")}${De("warning")}${De("error")}${De("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${K}; --oc-sdk-tone-text: ${Mt}; }

.oc-sdk-btn { border-radius: ${vt}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${Fo}; }
.oc-sdk-btn[data-variant="default"] { color: ${Mt}; background: ${g(K,10,W)}; border-color: ${g(K,12)}; ${Ko} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${g(K,16,W)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${g(K,22,W)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${Rr}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${J}, ${J}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${se}; ${Pt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${J}, ${J}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${y}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${J}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${h("status-error","red")}; color: ${yt}; background: ${g("var(--oc-sdk-tone)",7,W)}; border-color: ${g("var(--oc-sdk-tone)",12)}; ${Ko} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${g("var(--oc-sdk-tone)",9,W)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${g("var(--oc-sdk-tone)",11,W)}; box-shadow: none; }

.oc-sdk-field-note { color: ${I}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${yt}; }
.oc-sdk-input { border-radius: ${vt}; background: var(--oc-sdk-field-bg); color: ${se}; ${Lt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${I}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${Lt(g(D,26),"1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${Lt(h("status-error","red"),"1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${Nt}; }

.oc-sdk-search-icon { color: ${I}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${K}; }
.oc-sdk-search-clear { border-radius: ${Fo}; color: ${I}; }
.oc-sdk-search-clear:hover { background: ${y}; color: ${D}; }

.oc-sdk-trigger { border-radius: ${vt}; background: var(--oc-sdk-raised-bg); color: ${se}; ${Pt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${J}, ${J}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${I}; }
.oc-sdk-trigger-chevron { color: ${I}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${se}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${Ge}; background-clip: padding-box; color: ${se}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${y}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${Ct}; color: ${Ut}; }
.oc-sdk-option-check { color: ${D}; }
.oc-sdk-option[data-destructive="true"] { color: ${yt}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${g(h("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${I}; }
.oc-sdk-popup-empty { color: ${I}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${q}; border-radius: 4px; color: ${D}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${g(D,60,q)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${q}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${W}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${K}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${Bo} }
.oc-sdk-check-desc { color: ${I}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${g(D,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${I}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${D}; }
.oc-sdk-tab[aria-selected="true"] { color: ${Ut}; background: ${Ct}; border-color: ${q}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${se}; background: var(--oc-sdk-raised-bg); ${Pt} }
.oc-sdk-tab-count { color: ${I}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${g(D,6)}; color: ${I}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${g("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${y}; }
.oc-sdk-row[aria-selected="true"] { background: ${Ct}; color: ${Ut}; }
.oc-sdk-row-lead { font-family: ${Nt}; color: ${I}; }
.oc-sdk-row-sub { color: ${I}; }
.oc-sdk-row-meta { color: ${I}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${I}; }

.oc-sdk-empty-body { color: ${I}; }

.oc-sdk-spinner { color: ${I}; }
.oc-sdk-spinner-ring { border-color: ${q}; border-top-color: ${K}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${g("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${I}; }

.oc-sdk-separator { color: ${I}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${g(q,40)}; }

.oc-sdk-progress-label { color: ${I}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${g(D,6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${K}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${h("status-success","currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${h("success-text","inherit")}; }

.oc-sdk-text a { color: ${Mt}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${g(q,60)}; }
`,U=`
${Qe}
${Ir}
${jo}`;var Be=bt(),qo=document.querySelector("#directory"),zo=document.querySelector("#notice"),ae=document.querySelector("#hosts"),ce=document.querySelector("#hosts-config"),de=document.querySelector("#project-config"),Gt=document.querySelector("#result"),Cr=document.querySelector("#reload"),Ur=document.querySelector("#save"),L=null,Fe=0,Ke=new Map;function V(e,r="info"){zo.className=r==="error"?"error":r==="success"?"ok":"",zo.textContent=e}function Mr(e){Gt.hidden=!1,Gt.textContent=typeof e=="string"?e:JSON.stringify(e,null,2)}function Jo(e,r){let n;try{n=JSON.parse(e)}catch(d){throw new Error(`${r} is not valid JSON: ${d instanceof Error?d.message:String(d)}`)}if(!n||typeof n!="object"||Array.isArray(n))throw new Error(`${r} must be a JSON object.`);return n}async function Yo(e,r){if(!L)throw new Error("Open a project first.");let n=await Be.serviceRequest({method:"POST",path:e,body:JSON.stringify({...r,directory:L})}),d=JSON.parse(n.body||"{}");if(n.status<200||n.status>=300||d.ok===!1)throw new Error(d.error?.message??`Fleet service returned HTTP ${n.status}`);return d.result??d}async function yr(e){let r=await Be.serviceRequest({method:"GET",path:`/config?directory=${encodeURIComponent(e)}`,body:""}),n=JSON.parse(r.body||"{}");if(r.status<200||r.status>=300||n.ok===!1||!n.result)throw new Error(n.error?.message??`Fleet service returned HTTP ${r.status}`);return n.result}function Nr(e){let r=Jo(e,"Host registry");if(!r.hosts||typeof r.hosts!="object"||Array.isArray(r.hosts))throw new Error("Host registry needs a hosts object.");return r}function vr(e){let r=Jo(e,"Project configuration");if(typeof r.name!="string"||!r.name||!Array.isArray(r.hosts))throw new Error("Project configuration needs a name and a hosts array.");return r}function Lr(e){ae.replaceChildren();let r=e.project.hosts??[];if(r.length===0){let n=document.createElement("p");n.textContent="No hosts selected for this project yet.",ae.append(n);return}for(let n of r){let d=e.hosts.hosts?.[n],p=document.createElement("div");p.className="host";let A=document.createElement("div");A.className="row";let k=document.createElement("strong");k.textContent=n;let b=document.createElement("small");b.textContent=d?.ssh??"missing from host registry",A.append(k,b);let P=document.createElement("div");if(P.className="row",P.style.marginTop="8px",d)for(let[$,z]of[["Status","status"],["Plan","plan"],["Inspect recovery","recovery"]]){let F=document.createElement("button");F.textContent=$,F.dataset.action=z,F.dataset.host=n,P.append(F)}p.append(A,P),ae.append(p)}}function Qo(e,r){let n=Ke.get(r);ce.value=n?.hosts??`${JSON.stringify(e.hosts,null,2)}
`,de.value=n?.project??`${JSON.stringify(e.project,null,2)}
`,Lr(e);let d=Object.keys(e.hosts.hosts??{}).length,p=e.project.hosts?.length??0,A=e.legacy?" Legacy fleet.json detected; saving migrates it to local configuration.":"";V(`${d} host(s), ${p} selected for this project.${A}`,"success")}async function Ht(){let e=L;if(!e)return;let r=++Fe;V("Loading Fleet configuration\u2026");try{let n=await yr(e);if(L!==e||r!==Fe)return;Qo(n,e)}catch(n){if(L!==e||r!==Fe)return;let d=Ke.get(e);ce.value=d?.hosts??"",de.value=d?.project??"",ae.replaceChildren(),n instanceof c&&/not found/i.test(n.message)?V("No local Fleet project configuration yet. Add a host and save.","warning"):V(n instanceof Error?n.message:String(n),"error")}}Be.onReady(e=>{kt(e,document.documentElement),L=e.directory,qo.textContent=L??"Open a project to configure Fleet.",L&&Ht()});Be.onDirectory(e=>{Fe+=1,L=e,qo.textContent=e??"Open a project to configure Fleet.",Gt.hidden=!0,e?Ht():(ce.value="",de.value="",ae.replaceChildren())});function Zo(){L&&Ke.set(L,{hosts:ce.value,project:de.value})}ce.addEventListener("input",Zo);de.addEventListener("input",Zo);Cr.addEventListener("click",()=>void Ht());Ur.addEventListener("click",()=>{(async()=>{let e=L;if(!e){V("Open a project first.","error");return}try{let r=Nr(ce.value),n=vr(de.value),d=await Yo("/config",{hosts:r,project:n});if(L!==e)return;Ke.delete(e),Qo(d,e),V("Local Fleet configuration saved. Nothing was written to the repository.","success")}catch(r){if(L!==e)return;V(r instanceof Error?r.message:String(r),"error")}})()});ae.addEventListener("click",e=>{let r=e.target.closest("button[data-action]");if(!r)return;let n=r.dataset.action,d=r.dataset.host;!n||!d||(r.disabled=!0,V(`${n} on ${d}\u2026`),(async()=>{try{Mr(await Yo(n==="status"?"/status":n==="plan"?"/plan":"/recovery",{host:d})),V(`${n} completed.`,"success")}catch(p){V(p instanceof Error?p.message:String(p),"error")}finally{r.disabled=!1}})())});})();
