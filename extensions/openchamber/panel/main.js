"use strict";(()=>{var u="openchamber.sdk";var be="data-oc-scrolling",Ye=`
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
`;function Yt(e){let r=e.documentElement;if(r.hasAttribute("data-oc-scrollbar-activity"))return;r.setAttribute("data-oc-scrollbar-activity","");let s=new WeakMap;e.addEventListener("scroll",_=>{let d=_.target===e?r:_.target;if(!(d instanceof Element))return;d.hasAttribute("data-oc-scrolling")||d.setAttribute("data-oc-scrolling","");let A=s.get(d);A!==void 0&&clearTimeout(A),s.set(d,setTimeout(()=>{s.delete(d),d.removeAttribute("data-oc-scrolling")},1e3))},{capture:!0,passive:!0})}var Zo=`(${Yt.toString()})(document);`;var Qt=e=>{let r=[],s=0,_=0;return{push:d=>{for(r.push(d),_+=d.length;_-s>e&&r.length>1;){let A=r.shift();_-=A?.length??0,s=0}},pull:d=>{let A=0;for(;A<d.length&&r.length>0;){let k=r[0],b=Math.min(d.length-A,k.length-s);d.set(k.subarray(s,s+b),A),A+=b,s+=b,s>=k.length&&(r.shift(),_-=k.length,s=0)}d.fill(0,A)},clear:()=>{r.length=0,s=0,_=0},get size(){return _-s}}};var oo=/^[a-z][a-z0-9-]{0,39}$/;var Zt=e=>Object(e)===e&&!Array.isArray(e),Qe=(e,r)=>Object.keys(e).every(s=>r.includes(s)),eo=e=>String(e)===e&&e.length>=1&&e.length<=60,to=e=>String(e)===e&&e.length>=1&&e.length<=80,ro=e=>{if(!Array.isArray(e)||e.length>4)return!1;let r=new Set;for(let s of e){if(!Zt(s)||!oo.test(s.id)||!eo(s.label)||s.disabled!==void 0&&s.disabled!==!0&&s.disabled!==!1||r.has(s.id))return!1;if(r.add(s.id),s.kind==="button"){if(!Qe(s,["kind","id","label","disabled"]))return!1;continue}if(s.kind!=="select"||!Qe(s,["kind","id","label","value","options","disabled"])||!to(s.value)||!Array.isArray(s.options)||s.options.length<1||s.options.length>16)return!1;let _=new Set;for(let d of s.options){if(!Zt(d)||!Qe(d,["value","label"])||!to(d.value)||!eo(d.label)||_.has(d.value))return!1;_.add(d.value)}if(!_.has(s.value))return!1}return!0};var tr=1024*1024;var no=["{id}","{segment}","{segments+}"];var Hr=new Set(no);var so=["turn-finished","turn-failed","permission-asked","question-asked","turn-started","session-created","session-archived","session-deleted"];var $r=new Set(so);var Ze=e=>"bytes"in e?e.bytes.byteLength:e.content.length,io=(e,r)=>{if(e.path!==r.path||e.readOnly!==r.readOnly)return!1;if(e.encoding==="text"||r.encoding==="text")return e.encoding==="text"&&r.encoding==="text"&&e.content===r.content;if(e.bytes.byteLength!==r.bytes.byteLength)return!1;for(let s=0;s<e.bytes.byteLength;s+=1)if(e.bytes[s]!==r.bytes[s])return!1;return!0};var ao=/^[A-Za-z0-9_-]{1,80}$/;var co=["left","right","top","bottom"];var lo=(e,r=0,s={remaining:16e3})=>{if(--s.remaining<0||r>=32)return!1;if(e===null)return!0;let _=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let d of _)if(!lo(d,r+1,s))return!1;return!0},et=e=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every(r=>/^(0|[1-9]\d*)$/.test(r)&&Number(r)<e.length)&&e.every(et);if(Object(e)===e){let r=Object.getPrototypeOf(e);return(r===null||r===Object.prototype)&&Object.values(e).every(et)}return String(e)===e||Number.isFinite(e)},tt=e=>{try{return String(e.id)!==e.id||!ao.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!co.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!lo(e.data)||!et(e.data)?!1:JSON.stringify(e.data).length<=16e3}catch{return!1}};var _o=/^[0-9a-f]{7,64}$/i,po=e=>_o.test(e),ot=255,Eo=(e,r,s)=>({openCommit:_=>po(_)?e({channel:u,v:1,type:"open-commit",id:r(),payload:{sha:_}}):s("Commit id must be 7 to 64 hex characters."),openWalkthrough:({base:_})=>{let d=_.trim();return!d||d.length>ot?s(`Base must contain 1 to ${ot} characters.`):e({channel:u,v:1,type:"open-walkthrough",id:r(),payload:{base:d}})}});var nt=2e3;var To=["file","directory","other","missing"],st=e=>!!(e&&"sessionId"in e),it=e=>!!(e&&"sent"in e&&!("sessionId"in e));var ke=500,Ce=32e3,So=16e3,fo=128,Ao=200,Oo=2e3,Ro=16e3,ho=80,mo=200,Io=16e3;var xo=2e3;var at=2e4,Ue=1024,Me=2e6;var ye=64e3,Ne=8e3,ct=4e3;var dt=96e4,or=60*6e4;var go=999,bo=1e4,Ee=500,ko=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],Co=["stopped","starting","ready","failed"],rr=new Set(ko),Uo=e=>rr.has(e),Mo=e=>e&&Uo(e)?e:"HOST_REJECTED",oe=e=>e===void 0?!1:e===null||e===!0||e===!1||String(e)===e?!0:Number(e)===e?Number.isFinite(e):Array.isArray(e)?e.every(oe):Object(e)===e?Object.values(e).every(oe):!1,yo=e=>oe(e)&&JSON.stringify(e).length<=Io,uo=e=>e?.trim().slice(0,mo)??"",re=e=>{let r=e.id.trim().slice(0,fo),s=e.title.trim().slice(0,Ao),_=e.url.trim().slice(0,Oo),d=e.text?.trim().slice(0,Ro),A=e.author?.trim().slice(0,ho),k=e.kind==="pull"?"pull":"issue",b={providerId:e.providerId.trim(),id:r,title:s||r,url:_,kind:k};if(d&&(b.text=d),A&&(b.author=A),k==="pull"){let X=uo(e.branches?.head),$=uo(e.branches?.base);X&&$&&(b.branches={head:X,base:$})}return yo(e.data)&&(b.data=e.data),b},lt=e=>{let r=re(e);return e.projectId&&(r.projectId=e.projectId),e.navigation&&(r.navigation=e.navigation),e.worktree&&(r.worktree=e.worktree),r},_t=e=>{let r={text:e.text.trim().slice(0,So)};return e.send&&(r.send=!0),r},pt=e=>e===null||!Number.isFinite(e)?null:Math.min(go,Math.max(0,Math.round(e))),Et=e=>Number.isFinite(e)?Math.min(bo,Math.max(0,Math.ceil(e))):0;var ne=e=>e.length>0&&e.length<=Ue&&!e.includes("\0")&&!e.includes("\\");var ve=e=>!e.startsWith("/")||e.includes("\0")||e.includes("\\")||e.includes("://")||e.length>xo?!1:!e.split("/").some(s=>s==="."||s===".."),nr=new Set(Co),ut=e=>!!(e&&"status"in e&&nr.has(String(e.status))&&!("body"in e)),Le=e=>!!(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),Tt=e=>!!(e&&"content"in e&&String(e.content)===e.content),St=e=>!!(e&&"written"in e&&e.written===!0),ft=e=>!!(e&&"entries"in e&&Array.isArray(e.entries)),sr=new Set(To),At=e=>!!(e&&"kind"in e&&"size"in e&&sr.has(String(e.kind))&&Number.isFinite(e.size)),Ot=e=>!!(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),ir=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","service-event","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late","microphone-audio","microphone-ended"]),ar=e=>Object(e)===e?e:null,rt=e=>String(e)===e&&e.length>0,cr=e=>{if(!rt(e.id))return null;if(e.ok===!0){let r={channel:u,v:1,type:"result",id:e.id,ok:!0};return Object(e.payload)===e.payload&&(r.payload=e.payload),r}return e.ok===!1&&rt(e.error)?{channel:u,v:1,type:"result",id:e.id,ok:!1,error:e.error,code:Mo(rt(e.code)?e.code:void 0)}:null},Rt=e=>{let r=ar(e);return!r||r.channel!==u||r.v!==1?null:r.type==="result"?cr(r):!ir.has(String(r.type))||Object(r.payload)!==r.payload?null:r};var No=e=>"key"in e&&"metaKey"in e&&"ctrlKey"in e,dr=e=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s",c=class extends Error{code;constructor(r,s){super(s),this.name="HostRequestError",this.code=r}},vo=()=>Promise.reject(new c("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),Pe=()=>Promise.reject(new c("BAD_PATH",`File path must be 1 to ${Ue} characters without NUL or backslash.`)),we=e=>{if(e!==void 0){if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new c("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0}},E=e=>(e.value+=1,`oc-${e.value}`),gt=(e={})=>{let r=e.target??("window"in globalThis?window:null);if(!r)throw new c("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let s=e.acceptSource??(t=>t===r.parent),_=e.requestTimeoutMs??at,d=new Set,A=new Set,k=new Set,b=new Set,X=new Set,$=new Set,V=new Set,fe=new Set,Ae=new Set,Oe=new Set,Re=new Set,Y=new Set,Ke=[],ae=null,ce=null,he=new Set,me=new Set,de=null,le=null,We=!1,Q=new Map,Z=new Map,ee=new Map,D=!1,p={value:0},l=null,B=null,_e=!1,pe=!1,Ht=null,P=null,Xt=t=>t?{sessionId:t.id,phase:t.busy?"started":"completed"}:null,M=t=>{r.parent.postMessage(t,"*")},$t=()=>{D||r.parent===r||Y.size===0||l?.features?.lateGenerateResults!==!0||M({channel:u,v:1,type:"generate-late-listen"})},O=(t,o)=>{for(let a of t)try{a(o)}catch(i){console.error(i)}},Vt=t=>{if(!(t instanceof MessageEvent)||!s(t.source))return;let o=Rt(t.data);if(!o)return;if(o.type==="workspace"){let i=Z.get(o.payload.subscriptionId);i&&O([i],o.payload.snapshot);return}if(o.type==="shells"){let i=ee.get(o.payload.subscriptionId);i&&O([i],o.payload.snapshot);return}if(o.type==="microphone-audio"){P?.queue.push(o.payload.samples);return}if(o.type==="microphone-ended"){let i=P;if(!i)return;P=null,i.release(),O(i.endedListeners,o.payload.reason);return}if(o.type==="ready"){l=o.payload,B=Xt(o.payload.session),O(d,o.payload),O(A,o.payload.directory),O(k,o.payload.session),B&&O(b,B),O(X,o.payload.connection),O($,o.payload.settings),O(V,o.payload.item),o.payload.block&&O(fe,o.payload.block),$t();return}if(o.type==="service-event"){O(Ae,o.payload);return}if(o.type==="generate-late"){Y.size===0?Ke.push(o.payload):O(Y,o.payload);return}if(o.type==="directory"){l&&(l={...l,directory:o.payload.directory}),O(A,o.payload.directory);return}if(o.type==="session"){l&&(l={...l,session:o.payload.session}),o.payload.session?B?.sessionId!==o.payload.session.id&&(B=Xt(o.payload.session)):B=null,O(k,o.payload.session);return}if(o.type==="session-lifecycle"){B=o.payload,O(b,o.payload);return}if(o.type==="connection"){l&&(l={...l,connection:o.payload.connection}),O(X,o.payload.connection);return}if(o.type==="settings"){l&&(l={...l,settings:o.payload.settings}),O($,o.payload.settings);return}if(o.type==="item"){l&&(l={...l,item:o.payload.item}),O(V,o.payload.item);return}if(o.type==="status-control-event"){O(Oe,o.payload);return}if(o.type==="popover-closed"){O(Re,o.payload);return}if(o.type==="action"){let i=f=>{D||M({channel:u,v:1,type:"action-result",id:o.id,payload:f})},S=ce;if(!S){i({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>S(o.payload)).then(()=>i({ok:!0}),f=>{let R=(f instanceof Error?f.message:String(f)).trim();i({ok:!1,error:(R||"Action failed.").slice(0,Ee)})});return}if(o.type==="file-open"){let i=o.payload;if(le&&io(le,i))return;le=i,O(he,o.payload);return}if(o.type==="file-saved"){O(me,o.payload.version);return}if(o.type==="file-snapshot"){let i=R=>{D||M({channel:u,v:1,type:"file-snapshot-result",id:o.id,payload:R})},S=R=>i({error:(R.trim()||"Could not read the edited file.").slice(0,Ee)}),f=de;if(!f){S("This extension does not edit files.");return}Promise.resolve().then(()=>f(o.payload.purpose)).then(R=>{if(Ze(R)>2e7){S(`The file is over ${2e7} ${"bytes"in R?"bytes":"characters"}.`);return}if(R.version.length>256){S(`The snapshot version is over ${256} characters.`);return}i({snapshot:"bytes"in R?{bytes:R.bytes,version:R.version}:{content:R.content,version:R.version}})},R=>S(R instanceof Error?R.message:String(R)));return}if(o.type==="resolve"){let i=f=>{M({channel:u,v:1,type:"resolve-result",id:o.id,payload:f})},S=ae;if(!S){i({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>S(o.payload)).then(f=>i({item:f?re(f):null}),f=>{let R=(f instanceof Error?f.message:String(f)).trim();i({error:(R||"Command failed.").slice(0,Ee)})});return}let a=Q.get(o.id);if(a){if(clearTimeout(a.timer),Q.delete(o.id),o.ok){a.resolve(o.payload);return}a.reject(new c(o.code,o.error))}};r.addEventListener("message",Vt),M({channel:u,v:1,type:"hello"});let C=(t,o=_)=>D||r.parent===r?Promise.reject(new c("HOST_UNAVAILABLE","No host frame. This page is not in an iframe.")):new Promise((a,i)=>{let S=setTimeout(()=>{Q.delete(t.id),i(new c("HOST_TIMEOUT","Host did not answer in time."))},o);Q.set(t.id,{resolve:a,reject:i,timer:S}),M(t)}),g=t=>C(t).then(()=>{}),m={channel:u,v:1},je=t=>{!D&&r.parent!==r&&M(t)},Ft=()=>je({...m,type:"file-save"}),ze=()=>{!D&&r.parent!==r&&M({...m,type:"microphone-close",id:E(p)})},Yo=async()=>{if(P)throw new c("HOST_REJECTED","The microphone is already open in this frame.");if(l?.features?.microphone!==!0)throw new c("UNSUPPORTED","This OpenChamber cannot share the microphone with extensions.");let t=globalThis.AudioContext;if(typeof t!="function")throw new c("UNSUPPORTED","This frame has no Web Audio.");let o=new t;if(o.sampleRate<8e3||o.sampleRate>192e3)throw o.close().catch(()=>{}),new c("UNSUPPORTED",`Audio at ${o.sampleRate} Hz is not supported.`);let a=o.state==="suspended"?o.resume().catch(()=>{}):void 0,i=Qt(Math.round(o.sampleRate/4)),S=o.createScriptProcessor(1024,1,1);S.onaudioprocess=G=>i.pull(G.outputBuffer.getChannelData(0));let f=o.createMediaStreamDestination();S.connect(f);let R=new Set,te={queue:i,endedListeners:R,release:()=>{S.onaudioprocess=null,S.disconnect(),i.clear();for(let G of f.stream.getTracks())G.stop();o.close().catch(()=>{})}};P=te;try{let G=await C({...m,type:"microphone-open",id:E(p),payload:{sampleRate:o.sampleRate}},12e4);if(!G||!("opened"in G)||G.opened!==!0)throw new c("HOST_REJECTED","Host did not open the microphone.");if(await a,P!==te)throw new c("DISCONNECTED","The microphone closed while it was opening.")}catch(G){throw P===te&&(P=null),te.release(),ze(),G}return{stream:f.stream,close:()=>{P===te&&(P=null,te.release(),ze())},onEnded:G=>(R.add(G),()=>{R.delete(G)})}},Bt=t=>{!No(t)||!dr(t)||(t.preventDefault(),Ft())},Kt=t=>{!No(t)||t.key!=="Escape"||l?.surface!=="popover"||!l.popover||(t.preventDefault(),qt(l.popover.id,"escape").catch(()=>{}))},Ie=()=>{let t=l?.surface==="popover"?l.popover:void 0;if(!t)return;let o=_e||pe;Ht!==o&&(Ht=o,Jt(t.id,o).catch(()=>{}))},xe=()=>{l?.surface!=="popover"||_e||(_e=!0,Ie())},Wt=t=>{l?.surface!=="popover"||t.relatedTarget!==null||!_e||(_e=!1,Ie())},jt=()=>{l?.surface!=="popover"||pe||(pe=!0,Ie())},zt=()=>{l?.surface!=="popover"||!pe||(pe=!1,Ie())},H=(t,o=1024)=>{if(!t.trim()||t.length>o)throw new c("HOST_REJECTED",`Identity must contain 1 to ${o} characters.`)},qe=async t=>{t.kind!=="projects"&&H(t.projectId);let o=await C({...m,type:"workspace-read",id:E(p),payload:t});if(!o||!("kind"in o)||!("state"in o)||o.kind!==t.kind)throw new c("HOST_REJECTED","Host did not return workspace data.");return o},Je=async(t,o)=>{t.kind!=="projects"&&H(t.projectId);let a=E(p);Z.set(a,o);try{await g({...m,type:"workspace-subscribe",id:E(p),payload:{subscriptionId:a,query:t}})}catch(i){throw Z.delete(a),D||M({...m,type:"workspace-unsubscribe",id:E(p),payload:{subscriptionId:a}}),i}return()=>{!Z.delete(a)||D||M({...m,type:"workspace-unsubscribe",id:E(p),payload:{subscriptionId:a}})}},Qo=async(t,o)=>{t.kind==="session"&&H(t.sessionId),t.kind==="project"&&H(t.projectId);let a=E(p);ee.set(a,o);try{await g({...m,type:"shells-subscribe",id:E(p),payload:{subscriptionId:a,scope:t}})}catch(i){throw ee.delete(a),D||M({...m,type:"shells-unsubscribe",id:E(p),payload:{subscriptionId:a}}),i}return()=>{!ee.delete(a)||D||M({...m,type:"shells-unsubscribe",id:E(p),payload:{subscriptionId:a}})}},ge=async t=>{if("key"in t&&(t.key.length===0||t.key.length>128))throw new c("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!oe(t.value))throw new c("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>65536)throw new c("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&l?.features?.deviceStorage!==!0)throw new c("UNSUPPORTED","This host does not support device storage.");let o=await C({...m,type:"storage",id:E(p),payload:t});if(!o||!("storage"in o)||o.op!==t.op)throw new c("HOST_REJECTED","Host did not return storage data.");return o},qt=(t,o)=>l?.features?.popovers!==!0&&!(l?.surface==="popover"&&l.popover?.id===t)?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):g({...m,type:"popover-close",id:E(p),payload:o?{id:t,reason:o}:{id:t}}),Jt=(t,o)=>l?.features?.popovers!==!0&&!(l?.surface==="popover"&&l.popover?.id===t)?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):g({...m,type:"popover-anchor",id:E(p),payload:{id:t,active:o}});return r.addEventListener("keydown",Kt,!0),r.addEventListener("pointerover",xe),r.addEventListener("pointermove",xe),r.addEventListener("pointerout",Wt),r.addEventListener("focus",jt),r.addEventListener("blur",zt),{onAction:t=>(ce=t,()=>{ce===t&&(ce=null)}),listProjects:async()=>{let t=await qe({kind:"projects"});if(t.kind!=="projects")throw new c("HOST_REJECTED","Expected projects.");return t},listWorktrees:async t=>{let o=await qe({kind:"worktrees",projectId:t});if(o.kind!=="worktrees")throw new c("HOST_REJECTED","Expected worktrees.");return o},listSessions:async t=>{let o=await qe({kind:"sessions",projectId:t});if(o.kind!=="sessions")throw new c("HOST_REJECTED","Expected sessions.");return o},onProjects:t=>Je({kind:"projects"},o=>{o.kind==="projects"&&t(o)}),onWorktrees:(t,o)=>Je({kind:"worktrees",projectId:t},a=>{a.kind==="worktrees"&&o(a)}),onSessions:(t,o)=>Je({kind:"sessions",projectId:t},a=>{a.kind==="sessions"&&o(a)}),onRunningShells:(t,o)=>Qo(t,o),readShellOutput:async(t,o)=>{H(t,128);let a=o?.cursor;if(a!==void 0&&(!Number.isInteger(a)||a<0))throw new c("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let i=o?.tailBytes;if(i!==void 0&&(!Number.isInteger(i)||i<1||i>65536))throw new c("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${65536}.`);let f=await C({...m,type:"shell-output",id:E(p),payload:{shellId:t,cursor:a,tailBytes:i}});if(!f||typeof f.output!="string"||!Number.isFinite(f.cursor))throw new c("HOST_REJECTED","Host did not return shell output.");return f},stopShell:async t=>{if(H(t,128),(await C({...m,type:"shell-stop",id:E(p),payload:{shellId:t}}))?.stopped!==!0)throw new c("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async t=>{H(t),await g({...m,type:"open-session",id:E(p),payload:{sessionId:t}})},storage:{get:async(t,o)=>{let a=we(o),i={op:"get",key:t};a&&(i.scope=a);let S=await ge(i);return S.op==="get"&&S.found?S.value:void 0},set:async(t,o,a)=>{let i=we(a),S={op:"set",key:t,value:o};i&&(S.scope=i),await ge(S)},delete:async(t,o)=>{let a=we(o),i={op:"delete",key:t};a&&(i.scope=a),await ge(i)},keys:async t=>{let o=we(t),a={op:"keys"};o&&(a.scope=o);let i=await ge(a);if(i.op!=="keys")throw new c("HOST_REJECTED","Expected storage keys.");return i.keys}},onReady:t=>(d.add(t),l&&t(l),()=>{d.delete(t)}),onDirectory:t=>(A.add(t),l&&t(l.directory),()=>{A.delete(t)}),onSession:t=>(k.add(t),l&&t(l.session),()=>{k.delete(t)}),onSessionLifecycle:t=>(b.add(t),B&&t(B),()=>{b.delete(t)}),onConnection:t=>(X.add(t),l&&t(l.connection),()=>{X.delete(t)}),onSettings:t=>($.add(t),l&&t(l.settings),()=>{$.delete(t)}),onItem:t=>(V.add(t),l&&t(l.item),()=>{V.delete(t)}),onBlock:t=>(fe.add(t),l?.block&&t(l.block),()=>{fe.delete(t)}),onServiceEvent:t=>(Ae.add(t),()=>{Ae.delete(t)}),onStatusControl:t=>(Oe.add(t),()=>{Oe.delete(t)}),onPopoverClosed:t=>(Re.add(t),()=>{Re.delete(t)}),setStatusControls:t=>l?.features?.statusControls!==!0?Promise.reject(new c("UNSUPPORTED","This host does not support status controls.")):ro(t)?g({...m,type:"status-controls",id:E(p),payload:{controls:t}}):Promise.reject(new c("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options.")),openPopover:t=>l?.features?.popovers!==!0?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):tt(t)?g({...m,type:"popover-open",id:E(p),payload:t}):Promise.reject(new c("HOST_REJECTED","Popover requests need bounded geometry and JSON data.")),closePopover:qt,setPopoverAnchorActive:Jt,onResolve:t=>(ae=t,()=>{ae===t&&(ae=null)}),toast:t=>{let o=t.message.trim();return!o||o.length>ke?Promise.reject(new c("HOST_REJECTED",`Toast message must contain 1 to ${ke} characters.`)):t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>Ce)?Promise.reject(new c("HOST_REJECTED",`Toast copy text must contain 1 to ${Ce} characters.`)):g({channel:u,v:1,type:"toast",id:E(p),payload:{...t,message:o}})},openUrl:t=>g({channel:u,v:1,type:"open-url",id:E(p),payload:{url:t}}),...Eo(g,()=>E(p),t=>Promise.reject(new c("HOST_REJECTED",t))),answerBlock:t=>g({channel:u,v:1,type:"block-answer",id:E(p),payload:{text:t.trim().slice(0,nt)}}),openSurface:t=>g({channel:u,v:1,type:"open-surface",id:E(p),payload:{surfaceId:t}}),writeClipboard:t=>g({channel:u,v:1,type:"clipboard-write",id:E(p),payload:{text:t}}),compose:t=>g({channel:u,v:1,type:"compose",id:E(p),payload:t}),attach:t=>g({channel:u,v:1,type:"attach",id:E(p),payload:re(t)}),startSession:async t=>{t.projectId!==void 0&&H(t.projectId);let o=t.worktree;o&&o!==!0&&(o.kind==="existing"?H(o.directory):(o.name!==void 0&&H(o.name,200),o.baseBranch!==void 0&&H(o.baseBranch,200)));let a=await C({channel:u,v:1,type:"start-session",id:E(p),payload:lt(t)},e.requestTimeoutMs??18e4);if(!st(a))throw new c("HOST_REJECTED","Host did not return a session.");return a},prompt:t=>C({channel:u,v:1,type:"prompt",id:E(p),payload:_t(t)}).then(o=>{if(!it(o))throw new c("HOST_REJECTED","Host did not return a prompt result.");return o}),sessionLink:t=>g({channel:u,v:1,type:"session-link",id:E(p),payload:re(t)}),close:()=>g({channel:u,v:1,type:"close",id:E(p)}),oauthStart:()=>g({channel:u,v:1,type:"oauth-start",id:E(p)}),oauthDisconnect:()=>g({channel:u,v:1,type:"oauth-disconnect",id:E(p)}),request:t=>(ve(t.path)?C({channel:u,v:1,type:"request",id:E(p),payload:t}):vo()).then(o=>{if(!Le(o))throw new c("HOST_REJECTED","Host request result was empty.");return o}),serviceRequest:t=>(ve(t.path)?C({channel:u,v:1,type:"service-request",id:E(p),payload:t}):vo()).then(o=>{if(!Le(o))throw new c("HOST_REJECTED","Host service request result was empty.");return o}),serviceStatus:()=>C({channel:u,v:1,type:"service-status",id:E(p)}).then(t=>{if(!ut(t))throw new c("HOST_REJECTED","Host did not return service status.");return t}),readFile:t=>(ne(t)?C({channel:u,v:1,type:"file-read",id:E(p),payload:{path:t}}):Pe()).then(o=>{if(!Tt(o))throw new c("HOST_REJECTED","Host did not return file content.");return o}),writeFile:(t,o)=>ne(t)?o.length>Me?Promise.reject(new c("FILE_TOO_LARGE",`Content is over ${Me} characters.`)):C({channel:u,v:1,type:"file-write",id:E(p),payload:{path:t,content:o}}).then(a=>{if(!St(a))throw new c("HOST_REJECTED","Host did not confirm the write.");return a}):Pe(),listDir:t=>(ne(t)?C({channel:u,v:1,type:"file-list",id:E(p),payload:{path:t}}):Pe()).then(o=>{if(!ft(o))throw new c("HOST_REJECTED","Host did not return directory entries.");return o}),stat:t=>(ne(t)?C({channel:u,v:1,type:"file-stat",id:E(p),payload:{path:t}}):Pe()).then(o=>{if(!At(o))throw new c("HOST_REJECTED","Host did not return file status.");return o}),generate:t=>{let o=t.prompt.trim(),a=t.system?.trim();if(o.length===0||o.length>ye)return Promise.reject(new c("HOST_REJECTED",`Prompt must be 1 to ${ye} characters.`));if(a!==void 0&&(a.length===0||a.length>Ne))return Promise.reject(new c("HOST_REJECTED",`System prompt must be 1 to ${Ne} characters.`));let i=t.maxOutputTokens===void 0?void 0:Math.min(ct,Math.max(1,Math.floor(t.maxOutputTokens)));if(i!==void 0&&!Number.isFinite(i))return Promise.reject(new c("HOST_REJECTED","maxOutputTokens must be a number."));let S={prompt:o};return a!==void 0&&(S.system=a),i!==void 0&&(S.maxOutputTokens=i),C({channel:u,v:1,type:"generate",id:E(p),payload:S},e.requestTimeoutMs??dt).then(f=>{if(!Ot(f))throw new c("HOST_REJECTED","Host did not return generated text.");return f})},onLateGenerateResult:t=>{Y.add(t);for(let o of Ke.splice(0))O([t],o);return $t(),()=>{Y.delete(t)}},openMicrophone:Yo,setBadge:t=>g({channel:u,v:1,type:"badge",id:E(p),payload:{count:pt(t)}}),setHeight:t=>g({channel:u,v:1,type:"resize",id:E(p),payload:{height:Et(t)}}),onFileOpen:t=>(he.add(t),We||(We=!0,r.addEventListener("keydown",Bt,!0)),le&&t(le),()=>{he.delete(t)}),onFileSnapshot:t=>(de=t,()=>{de===t&&(de=null)}),onFileSaved:t=>(me.add(t),()=>{me.delete(t)}),reportFileChange:t=>je({...m,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:Ft,reportFileUnsupported:()=>je({...m,type:"file-unsupported"}),dispose:()=>{for(let t of Z.keys())M({...m,type:"workspace-unsubscribe",id:E(p),payload:{subscriptionId:t}});Z.clear();for(let t of ee.keys())M({...m,type:"shells-unsubscribe",id:E(p),payload:{subscriptionId:t}});ee.clear(),P&&(ze(),P.release(),P=null),D=!0,ae=null,ce=null,de=null,he.clear(),me.clear(),We&&r.removeEventListener("keydown",Bt,!0),r.removeEventListener("message",Vt),r.removeEventListener("keydown",Kt,!0),r.removeEventListener("pointerover",xe),r.removeEventListener("pointermove",xe),r.removeEventListener("pointerout",Wt),r.removeEventListener("focus",jt),r.removeEventListener("blur",zt);for(let t of Q.values())clearTimeout(t.timer),t.reject(new c("HOST_UNAVAILABLE","Host client was disposed."));Q.clear(),d.clear(),A.clear(),k.clear(),b.clear(),X.clear(),$.clear(),V.clear(),fe.clear(),Ae.clear(),Oe.clear(),Re.clear(),Y.clear(),Ke.length=0}}};var Ho=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var cn=new Set(Ho);var lr=10*6e4;var _r=10*6e4;var pr=10*6e4;var Er=10*6e4;var Xo=["none","agent","user"];var ln=new Set(Xo);var ur=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],Tr=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],$o=(e,r)=>{r.style.colorScheme=e.mode;for(let[s,_]of ur)r.style.setProperty(s,e.tokens[_]);for(let[s,_,d]of Tr){let A=e.tokens[d]??"";r.style.setProperty(s,A),r.style.setProperty(_,A)}r.style.setProperty("font-family",e.tokens.font),r.style.setProperty("font-size",e.tokens.fontSize??"0.875rem"),r.style.setProperty("line-height","1.45"),r.style.setProperty("color",e.tokens.foreground)},bt=(e,r)=>{$o(e.theme,r),r.dataset&&(r.dataset.ocSurface=e.surface,r.dataset.ocTheme=e.theme.mode)};var Sr={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},h=(e,r)=>`var(--${e}, var(--oc-${Sr[e]}, ${r}))`,W=h("surface-background","transparent"),De=h("surface-elevated","transparent"),se=h("surface-elevated-foreground","inherit"),w=h("surface-foreground","inherit"),I=h("surface-muted-foreground","gray"),fr=h("surface-muted","transparent"),z=h("interactive-border","currentColor"),y=h("interactive-hover","transparent"),q=h("interactive-active","transparent"),kt=h("interactive-selection","transparent"),Ct=h("interactive-selection-foreground","inherit"),K=h("primary","currentColor"),Ut=h("primary-text","inherit"),Mt=h("error-text","inherit"),Ar=h("font-sans","inherit"),yt=h("font-mono","monospace"),Ko=h("radius","9px"),Nt=`calc(${Ko} - 2px)`,Vo=`calc(${Ko} - 4px)`,x=(e,r,s="transparent")=>`color-mix(in srgb, ${e} ${r}%, ${s})`,Fo=`background-image: linear-gradient(${y}, ${y});`,vt=(e,r="0.5px")=>`box-shadow: inset 0 0 0 ${r} ${e}, var(--oc-sdk-field-lift);`,Lt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",Bo="box-shadow: var(--oc-sdk-lit);",Pt=`inset 0 0.5px 0 0 ${x(w,8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`,Or=`
:root {
  --oc-sdk-edge: ${x(w,16)};
  --oc-sdk-field-bg: ${De};
  --oc-sdk-raised-bg: ${W};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${x(w,14)};
  --oc-sdk-field-bg: ${x(W,50,De)};
  --oc-sdk-raised-bg: ${De};
  --oc-sdk-field-lift: ${Pt};
  --oc-sdk-raised-lift: ${Pt};
  --oc-sdk-lit: ${Pt};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`,Ge=e=>{let r=h(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${r}; --oc-sdk-tone-text: ${h(`${e}-text`,"inherit")}; }`},n=e=>`calc(${e}rem / 14)`,Rr=`
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${n(8)}; height: ${n(32)}; padding: 0 ${n(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${n(6)}; height: ${n(28)}; padding: 0 ${n(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${n(4)}; height: ${n(24)}; padding: 0 ${n(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${n(14)}; height: ${n(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${n(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${n(32)}; padding: 0 ${n(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${n(8)} ${n(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${n(34)}; padding-right: ${n(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${n(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${n(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${n(24)}; height: ${n(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${n(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${n(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${n(28)}; padding: 0 ${n(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${n(2)}; min-width: ${n(160)}; max-width: calc(100vw - ${n(16)}); max-height: min(${n(320)}, calc(100vh - ${n(16)})); overflow: auto; padding: ${n(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${n(2)} ${n(2)} ${n(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${n(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${n(8)}; width: 100%; padding: ${n(6)} ${n(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${n(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${n(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${n(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${n(14)}; height: ${n(14)}; margin-top: ${n(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${n(36)}; height: ${n(20)}; --oc-sdk-thumb-travel: ${n(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${n(2)}; left: ${n(2)}; width: ${n(16)}; height: ${n(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${n(2)}; padding: ${n(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${n(6)}; height: ${n(28)}; padding: 0 ${n(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${n(1)} ${n(6)}; font-size: ${n(11)}; font-weight: 500; line-height: ${n(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${n(8)}; width: 100%; padding: ${n(6)} ${n(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${n(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${n(16)} ${n(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${n(4)}; padding: ${n(40)} ${n(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${n(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${n(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${n(16)}; height: ${n(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${n(12)}; height: ${n(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${n(12)}; padding: ${n(8)} ${n(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${n(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${n(8)}; width: 100%; margin: ${n(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${n(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${n(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${n(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${n(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${n(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${n(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${n(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${n(36)}; height: ${n(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${n(44)}; }
  .oc-sdk-check { min-height: ${n(36)}; padding: ${n(8)} 0; }
}
`,Wo=`${Or}
.oc-sdk { color: ${w}; font-family: ${Ar}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${Fo} }
.oc-sdk-mono { font-family: ${yt}; }
.oc-sdk-muted { color: ${I}; }
${Ge("success")}${Ge("warning")}${Ge("error")}${Ge("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${K}; --oc-sdk-tone-text: ${Ut}; }

.oc-sdk-btn { border-radius: ${Nt}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${Vo}; }
.oc-sdk-btn[data-variant="default"] { color: ${Ut}; background: ${x(K,10,W)}; border-color: ${x(K,12)}; ${Bo} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${x(K,16,W)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${x(K,22,W)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${fr}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${q}, ${q}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${se}; ${Lt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${q}, ${q}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${y}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${q}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${h("status-error","red")}; color: ${Mt}; background: ${x("var(--oc-sdk-tone)",7,W)}; border-color: ${x("var(--oc-sdk-tone)",12)}; ${Bo} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${x("var(--oc-sdk-tone)",9,W)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${x("var(--oc-sdk-tone)",11,W)}; box-shadow: none; }

.oc-sdk-field-note { color: ${I}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${Mt}; }
.oc-sdk-input { border-radius: ${Nt}; background: var(--oc-sdk-field-bg); color: ${se}; ${vt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${I}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${vt(x(w,26),"1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${vt(h("status-error","red"),"1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${yt}; }

.oc-sdk-search-icon { color: ${I}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${K}; }
.oc-sdk-search-clear { border-radius: ${Vo}; color: ${I}; }
.oc-sdk-search-clear:hover { background: ${y}; color: ${w}; }

.oc-sdk-trigger { border-radius: ${Nt}; background: var(--oc-sdk-raised-bg); color: ${se}; ${Lt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${q}, ${q}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${I}; }
.oc-sdk-trigger-chevron { color: ${I}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${se}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${De}; background-clip: padding-box; color: ${se}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${y}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${kt}; color: ${Ct}; }
.oc-sdk-option-check { color: ${w}; }
.oc-sdk-option[data-destructive="true"] { color: ${Mt}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${x(h("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${I}; }
.oc-sdk-popup-empty { color: ${I}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${z}; border-radius: 4px; color: ${w}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${x(w,60,z)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${z}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${W}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${K}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${Fo} }
.oc-sdk-check-desc { color: ${I}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${x(w,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${I}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${w}; }
.oc-sdk-tab[aria-selected="true"] { color: ${Ct}; background: ${kt}; border-color: ${z}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${se}; background: var(--oc-sdk-raised-bg); ${Lt} }
.oc-sdk-tab-count { color: ${I}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${x(w,6)}; color: ${I}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${x("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${y}; }
.oc-sdk-row[aria-selected="true"] { background: ${kt}; color: ${Ct}; }
.oc-sdk-row-lead { font-family: ${yt}; color: ${I}; }
.oc-sdk-row-sub { color: ${I}; }
.oc-sdk-row-meta { color: ${I}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${I}; }

.oc-sdk-empty-body { color: ${I}; }

.oc-sdk-spinner { color: ${I}; }
.oc-sdk-spinner-ring { border-color: ${z}; border-top-color: ${K}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${x("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${I}; }

.oc-sdk-separator { color: ${I}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${x(z,40)}; }

.oc-sdk-progress-label { color: ${I}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${x(w,6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${K}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${h("status-success","currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${h("success-text","inherit")}; }

.oc-sdk-text a { color: ${Ut}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${x(z,60)}; }
`,U=`
${Ye}
${Rr}
${Wo}`;var Se=gt(),zo=document.querySelector("#directory"),jo=document.querySelector("#notice"),Te=document.querySelector("#hosts"),J=document.querySelector("#config"),Gt=document.querySelector("#result"),gr=document.querySelector("#reload"),br=document.querySelector("#save"),L=null,Fe=0,Be=new Map;function F(e,r="info"){jo.className=r==="error"?"error":r==="success"?"ok":"",jo.textContent=e}function kr(e){Gt.hidden=!1,Gt.textContent=typeof e=="string"?e:JSON.stringify(e,null,2)}async function Cr(e,r){if(!L)throw new Error("Open a project first.");let s=await Se.serviceRequest({method:"POST",path:e,body:JSON.stringify({...r,directory:L})}),_=JSON.parse(s.body||"{}");if(s.status<200||s.status>=300||_.ok===!1)throw new Error(_.error?.message??`Fleet service returned HTTP ${s.status}`);return _.result??_}function qo(e){let r=JSON.parse(e);if(!r||typeof r.name!="string"||!r.name||!r.hosts||typeof r.hosts!="object")throw new Error("fleet.json needs a non-empty name and a hosts object.");return r}function Jo(e){Te.replaceChildren();for(let[r,s]of Object.entries(e.hosts)){let _=document.createElement("div");_.className="host";let d=document.createElement("div");d.className="row";let A=document.createElement("strong");A.textContent=r;let k=document.createElement("small");k.textContent=s.ssh,d.append(A,k);let b=document.createElement("div");b.className="row",b.style.marginTop="8px";for(let[X,$]of[["Status","status"],["Plan","plan"],["Inspect recovery","recovery"]]){let V=document.createElement("button");V.textContent=X,V.dataset.action=$,V.dataset.host=r,b.append(V)}_.append(d,b),Te.append(_)}}async function Dt(){let e=L;if(!e)return;let r=++Fe;F("Loading Fleet configuration\u2026");try{let s=await Se.readFile("fleet.json");if(L!==e||r!==Fe)return;let _=Be.get(e);J.value=_??s.content;let d=qo(J.value);Jo(d),F(`${Object.keys(d.hosts).length} configured host(s).`,"success")}catch(s){if(L!==e||r!==Fe)return;let _=Be.get(e);J.value=_??"",Te.replaceChildren(),s instanceof c&&/not found/i.test(s.message)?F("No fleet.json in this project. Create one below or run fleet init."):F(s instanceof Error?s.message:String(s),"error")}}Se.onReady(e=>{bt(e,document.documentElement),L=e.directory,zo.textContent=L??"Open a project to load its fleet.json.",L&&Dt()});Se.onDirectory(e=>{Fe+=1,L=e,zo.textContent=e??"Open a project to load its fleet.json.",Gt.hidden=!0,e?Dt():(J.value="",Te.replaceChildren())});J.addEventListener("input",()=>{L&&Be.set(L,J.value)});gr.addEventListener("click",()=>void Dt());br.addEventListener("click",()=>{(async()=>{let e=L;if(!e){F("Open a project first.","error");return}try{let r=qo(J.value);if(await Se.writeFile("fleet.json",`${JSON.stringify(r,null,2)}
`),L!==e)return;Be.delete(e),Jo(r),F("fleet.json saved.","success")}catch(r){if(L!==e)return;F(r instanceof Error?r.message:String(r),"error")}})()});Te.addEventListener("click",e=>{let r=e.target.closest("button[data-action]");if(!r)return;let s=r.dataset.action,_=r.dataset.host;!s||!_||(r.disabled=!0,F(`${s} on ${_}\u2026`),(async()=>{try{kr(await Cr(s==="status"?"/status":s==="plan"?"/plan":"/recovery",{host:_})),F(`${s} completed.`,"success")}catch(d){F(d instanceof Error?d.message:String(d),"error")}finally{r.disabled=!1}})())});})();
