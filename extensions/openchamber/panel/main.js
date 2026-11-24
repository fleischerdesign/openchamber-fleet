"use strict";(()=>{var u="openchamber.sdk";var ge="data-oc-scrolling",qe=`
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
:hover, [${ge}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${ge}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${ge}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${ge}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;function qt(e){let r=e.documentElement;if(r.hasAttribute("data-oc-scrollbar-activity"))return;r.setAttribute("data-oc-scrollbar-activity","");let s=new WeakMap;e.addEventListener("scroll",p=>{let l=p.target===e?r:p.target;if(!(l instanceof Element))return;l.hasAttribute("data-oc-scrolling")||l.setAttribute("data-oc-scrolling","");let A=s.get(l);A!==void 0&&clearTimeout(A),s.set(l,setTimeout(()=>{s.delete(l),l.removeAttribute("data-oc-scrolling")},1e3))},{capture:!0,passive:!0})}var Yo=`(${qt.toString()})(document);`;var Jt=e=>{let r=[],s=0,p=0;return{push:l=>{for(r.push(l),p+=l.length;p-s>e&&r.length>1;){let A=r.shift();p-=A?.length??0,s=0}},pull:l=>{let A=0;for(;A<l.length&&r.length>0;){let k=r[0],b=Math.min(l.length-A,k.length-s);l.set(k.subarray(s,s+b),A),A+=b,s+=b,s>=k.length&&(r.shift(),p-=k.length,s=0)}l.fill(0,A)},clear:()=>{r.length=0,s=0,p=0},get size(){return p-s}}};var eo=/^[a-z][a-z0-9-]{0,39}$/;var Yt=e=>Object(e)===e&&!Array.isArray(e),Je=(e,r)=>Object.keys(e).every(s=>r.includes(s)),Qt=e=>String(e)===e&&e.length>=1&&e.length<=60,Zt=e=>String(e)===e&&e.length>=1&&e.length<=80,to=e=>{if(!Array.isArray(e)||e.length>4)return!1;let r=new Set;for(let s of e){if(!Yt(s)||!eo.test(s.id)||!Qt(s.label)||s.disabled!==void 0&&s.disabled!==!0&&s.disabled!==!1||r.has(s.id))return!1;if(r.add(s.id),s.kind==="button"){if(!Je(s,["kind","id","label","disabled"]))return!1;continue}if(s.kind!=="select"||!Je(s,["kind","id","label","value","options","disabled"])||!Zt(s.value)||!Array.isArray(s.options)||s.options.length<1||s.options.length>16)return!1;let p=new Set;for(let l of s.options){if(!Yt(l)||!Je(l,["value","label"])||!Zt(l.value)||!Qt(l.label)||p.has(l.value))return!1;p.add(l.value)}if(!p.has(s.value))return!1}return!0};var Zo=1024*1024;var oo=["{id}","{segment}","{segments+}"];var Gr=new Set(oo);var ro=["turn-finished","turn-failed","permission-asked","question-asked","turn-started","session-created","session-archived","session-deleted"];var Hr=new Set(ro);var Ye=e=>"bytes"in e?e.bytes.byteLength:e.content.length,no=(e,r)=>{if(e.path!==r.path||e.readOnly!==r.readOnly)return!1;if(e.encoding==="text"||r.encoding==="text")return e.encoding==="text"&&r.encoding==="text"&&e.content===r.content;if(e.bytes.byteLength!==r.bytes.byteLength)return!1;for(let s=0;s<e.bytes.byteLength;s+=1)if(e.bytes[s]!==r.bytes[s])return!1;return!0};var so=/^[A-Za-z0-9_-]{1,80}$/;var io=["left","right","top","bottom"];var ao=(e,r=0,s={remaining:16e3})=>{if(--s.remaining<0||r>=32)return!1;if(e===null)return!0;let p=Array.isArray(e)?e:Object(e)===e?Object.values(e):[];for(let l of p)if(!ao(l,r+1,s))return!1;return!0},Qe=e=>{if(e===null||e===!0||e===!1)return!0;if(Array.isArray(e))return Object.keys(e).every(r=>/^(0|[1-9]\d*)$/.test(r)&&Number(r)<e.length)&&e.every(Qe);if(Object(e)===e){let r=Object.getPrototypeOf(e);return(r===null||r===Object.prototype)&&Object.values(e).every(Qe)}return String(e)===e||Number.isFinite(e)},Ze=e=>{try{return String(e.id)!==e.id||!so.test(e.id)||!Number.isFinite(e.anchor.x)||Math.abs(e.anchor.x)>1e5||!Number.isFinite(e.anchor.y)||Math.abs(e.anchor.y)>1e5||!Number.isFinite(e.anchor.width)||!Number.isFinite(e.anchor.height)||e.anchor.width<=0||e.anchor.height<=0||e.anchor.width>1e5||e.anchor.height>1e5||!Number.isInteger(e.width)||e.width<160||e.width>640||!Number.isInteger(e.height)||e.height<48||e.height>480||e.side!==void 0&&!io.includes(e.side)||e.focus!==void 0&&e.focus!==!0&&e.focus!==!1||!ao(e.data)||!Qe(e.data)?!1:JSON.stringify(e.data).length<=16e3}catch{return!1}};var co=/^[0-9a-f]{7,64}$/i,lo=e=>co.test(e),et=255,_o=(e,r,s)=>({openCommit:p=>lo(p)?e({channel:u,v:1,type:"open-commit",id:r(),payload:{sha:p}}):s("Commit id must be 7 to 64 hex characters."),openWalkthrough:({base:p})=>{let l=p.trim();return!l||l.length>et?s(`Base must contain 1 to ${et} characters.`):e({channel:u,v:1,type:"open-walkthrough",id:r(),payload:{base:l}})}});var ot=2e3;var po=["file","directory","other","missing"],rt=e=>!!(e&&"sessionId"in e),nt=e=>!!(e&&"sent"in e&&!("sessionId"in e));var be=500,ke=32e3,uo=16e3,To=128,So=200,fo=2e3,Ao=16e3,Oo=80,Ro=200,ho=16e3;var mo=2e3;var st=2e4,Ce=1024,Ue=2e6;var Me=64e3,ye=8e3,it=4e3;var at=96e4,er=60*6e4;var Io=999,xo=1e4,Ee=500,go=["HOST_UNAVAILABLE","HOST_TIMEOUT","HOST_REJECTED","DISCONNECTED","DISABLED","BAD_PATH","NO_INTEGRATION","NO_SERVICE","SERVICE_FAILED","REQUEST_FAILED","RESPONSE_TOO_LARGE","NO_SESSION","SESSION_BUSY","NOT_GRANTED","NO_DIRECTORY","NOT_FOUND","FILE_TOO_LARGE","DENIED","NO_MODEL","MODEL_FAILED","UNSUPPORTED"],bo=["stopped","starting","ready","failed"],tr=new Set(go),ko=e=>tr.has(e),Co=e=>e&&ko(e)?e:"HOST_REJECTED",ee=e=>e===void 0?!1:e===null||e===!0||e===!1||String(e)===e?!0:Number(e)===e?Number.isFinite(e):Array.isArray(e)?e.every(ee):Object(e)===e?Object.values(e).every(ee):!1,Uo=e=>ee(e)&&JSON.stringify(e).length<=ho,Eo=e=>e?.trim().slice(0,Ro)??"",te=e=>{let r=e.id.trim().slice(0,To),s=e.title.trim().slice(0,So),p=e.url.trim().slice(0,fo),l=e.text?.trim().slice(0,Ao),A=e.author?.trim().slice(0,Oo),k=e.kind==="pull"?"pull":"issue",b={providerId:e.providerId.trim(),id:r,title:s||r,url:p,kind:k};if(l&&(b.text=l),A&&(b.author=A),k==="pull"){let H=Eo(e.branches?.head),X=Eo(e.branches?.base);H&&X&&(b.branches={head:H,base:X})}return Uo(e.data)&&(b.data=e.data),b},ct=e=>{let r=te(e);return e.projectId&&(r.projectId=e.projectId),e.navigation&&(r.navigation=e.navigation),e.worktree&&(r.worktree=e.worktree),r},dt=e=>{let r={text:e.text.trim().slice(0,uo)};return e.send&&(r.send=!0),r},lt=e=>e===null||!Number.isFinite(e)?null:Math.min(Io,Math.max(0,Math.round(e))),_t=e=>Number.isFinite(e)?Math.min(xo,Math.max(0,Math.ceil(e))):0;var oe=e=>e.length>0&&e.length<=Ce&&!e.includes("\0")&&!e.includes("\\");var Ne=e=>!e.startsWith("/")||e.includes("\0")||e.includes("\\")||e.includes("://")||e.length>mo?!1:!e.split("/").some(s=>s==="."||s===".."),or=new Set(bo),Et=e=>!!(e&&"status"in e&&or.has(String(e.status))&&!("body"in e)),ve=e=>!!(e&&"status"in e&&"body"in e&&Number.isInteger(e.status)),pt=e=>!!(e&&"content"in e&&String(e.content)===e.content),ut=e=>!!(e&&"written"in e&&e.written===!0),Tt=e=>!!(e&&"entries"in e&&Array.isArray(e.entries)),rr=new Set(po),St=e=>!!(e&&"kind"in e&&"size"in e&&rr.has(String(e.kind))&&Number.isFinite(e.size)),ft=e=>!!(e&&"text"in e&&String(e.text)===e.text&&!("status"in e)),nr=new Set(["workspace","shells","ready","directory","session","connection","settings","session-lifecycle","item","resolve","action","service-event","status-control-event","popover-closed","file-open","file-snapshot","file-saved","generate-late","microphone-audio","microphone-ended"]),sr=e=>Object(e)===e?e:null,tt=e=>String(e)===e&&e.length>0,ir=e=>{if(!tt(e.id))return null;if(e.ok===!0){let r={channel:u,v:1,type:"result",id:e.id,ok:!0};return Object(e.payload)===e.payload&&(r.payload=e.payload),r}return e.ok===!1&&tt(e.error)?{channel:u,v:1,type:"result",id:e.id,ok:!1,error:e.error,code:Co(tt(e.code)?e.code:void 0)}:null},At=e=>{let r=sr(e);return!r||r.channel!==u||r.v!==1?null:r.type==="result"?ir(r):!nr.has(String(r.type))||Object(r.payload)!==r.payload?null:r};var Mo=e=>"key"in e&&"metaKey"in e&&"ctrlKey"in e,ar=e=>(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==="s",c=class extends Error{code;constructor(r,s){super(s),this.name="HostRequestError",this.code=r}},yo=()=>Promise.reject(new c("BAD_PATH",'Request path must start with "/" and stay on the declared origin.')),Le=()=>Promise.reject(new c("BAD_PATH",`File path must be 1 to ${Ce} characters without NUL or backslash.`)),Pe=e=>{if(e!==void 0){if(Object(e)!==e||Array.isArray(e)||e.scope!==void 0&&e.scope!=="instance"&&e.scope!=="device")throw new c("HOST_REJECTED",'Storage scope must be "instance" or "device".');return e.scope==="device"?"device":void 0}},E=e=>(e.value+=1,`oc-${e.value}`),It=(e={})=>{let r=e.target??("window"in globalThis?window:null);if(!r)throw new c("HOST_UNAVAILABLE","No window. connectHost runs in a browser frame.");let s=e.acceptSource??(t=>t===r.parent),p=e.requestTimeoutMs??st,l=new Set,A=new Set,k=new Set,b=new Set,H=new Set,X=new Set,$=new Set,Se=new Set,fe=new Set,Ae=new Set,Oe=new Set,q=new Set,Fe=[],ie=null,ae=null,Re=new Set,he=new Set,ce=null,de=null,Be=!1,J=new Map,Y=new Map,Q=new Map,G=!1,_={value:0},d=null,V=null,le=!1,_e=!1,Gt=null,L=null,Dt=t=>t?{sessionId:t.id,phase:t.busy?"started":"completed"}:null,M=t=>{r.parent.postMessage(t,"*")},Ht=()=>{G||r.parent===r||q.size===0||d?.features?.lateGenerateResults!==!0||M({channel:u,v:1,type:"generate-late-listen"})},O=(t,o)=>{for(let a of t)try{a(o)}catch(i){console.error(i)}},Xt=t=>{if(!(t instanceof MessageEvent)||!s(t.source))return;let o=At(t.data);if(!o)return;if(o.type==="workspace"){let i=Y.get(o.payload.subscriptionId);i&&O([i],o.payload.snapshot);return}if(o.type==="shells"){let i=Q.get(o.payload.subscriptionId);i&&O([i],o.payload.snapshot);return}if(o.type==="microphone-audio"){L?.queue.push(o.payload.samples);return}if(o.type==="microphone-ended"){let i=L;if(!i)return;L=null,i.release(),O(i.endedListeners,o.payload.reason);return}if(o.type==="ready"){d=o.payload,V=Dt(o.payload.session),O(l,o.payload),O(A,o.payload.directory),O(k,o.payload.session),V&&O(b,V),O(H,o.payload.connection),O(X,o.payload.settings),O($,o.payload.item),o.payload.block&&O(Se,o.payload.block),Ht();return}if(o.type==="service-event"){O(fe,o.payload);return}if(o.type==="generate-late"){q.size===0?Fe.push(o.payload):O(q,o.payload);return}if(o.type==="directory"){d&&(d={...d,directory:o.payload.directory}),O(A,o.payload.directory);return}if(o.type==="session"){d&&(d={...d,session:o.payload.session}),o.payload.session?V?.sessionId!==o.payload.session.id&&(V=Dt(o.payload.session)):V=null,O(k,o.payload.session);return}if(o.type==="session-lifecycle"){V=o.payload,O(b,o.payload);return}if(o.type==="connection"){d&&(d={...d,connection:o.payload.connection}),O(H,o.payload.connection);return}if(o.type==="settings"){d&&(d={...d,settings:o.payload.settings}),O(X,o.payload.settings);return}if(o.type==="item"){d&&(d={...d,item:o.payload.item}),O($,o.payload.item);return}if(o.type==="status-control-event"){O(Ae,o.payload);return}if(o.type==="popover-closed"){O(Oe,o.payload);return}if(o.type==="action"){let i=f=>{G||M({channel:u,v:1,type:"action-result",id:o.id,payload:f})},S=ae;if(!S){i({ok:!1,error:"This extension does not handle background actions."});return}Promise.resolve().then(()=>S(o.payload)).then(()=>i({ok:!0}),f=>{let R=(f instanceof Error?f.message:String(f)).trim();i({ok:!1,error:(R||"Action failed.").slice(0,Ee)})});return}if(o.type==="file-open"){let i=o.payload;if(de&&no(de,i))return;de=i,O(Re,o.payload);return}if(o.type==="file-saved"){O(he,o.payload.version);return}if(o.type==="file-snapshot"){let i=R=>{G||M({channel:u,v:1,type:"file-snapshot-result",id:o.id,payload:R})},S=R=>i({error:(R.trim()||"Could not read the edited file.").slice(0,Ee)}),f=ce;if(!f){S("This extension does not edit files.");return}Promise.resolve().then(()=>f(o.payload.purpose)).then(R=>{if(Ye(R)>2e7){S(`The file is over ${2e7} ${"bytes"in R?"bytes":"characters"}.`);return}if(R.version.length>256){S(`The snapshot version is over ${256} characters.`);return}i({snapshot:"bytes"in R?{bytes:R.bytes,version:R.version}:{content:R.content,version:R.version}})},R=>S(R instanceof Error?R.message:String(R)));return}if(o.type==="resolve"){let i=f=>{M({channel:u,v:1,type:"resolve-result",id:o.id,payload:f})},S=ie;if(!S){i({error:"This extension does not resolve commands."});return}Promise.resolve().then(()=>S(o.payload)).then(f=>i({item:f?te(f):null}),f=>{let R=(f instanceof Error?f.message:String(f)).trim();i({error:(R||"Command failed.").slice(0,Ee)})});return}let a=J.get(o.id);if(a){if(clearTimeout(a.timer),J.delete(o.id),o.ok){a.resolve(o.payload);return}a.reject(new c(o.code,o.error))}};r.addEventListener("message",Xt),M({channel:u,v:1,type:"hello"});let C=(t,o=p)=>G||r.parent===r?Promise.reject(new c("HOST_UNAVAILABLE","No host frame. This page is not in an iframe.")):new Promise((a,i)=>{let S=setTimeout(()=>{J.delete(t.id),i(new c("HOST_TIMEOUT","Host did not answer in time."))},o);J.set(t.id,{resolve:a,reject:i,timer:S}),M(t)}),g=t=>C(t).then(()=>{}),m={channel:u,v:1},Ke=t=>{!G&&r.parent!==r&&M(t)},$t=()=>Ke({...m,type:"file-save"}),We=()=>{!G&&r.parent!==r&&M({...m,type:"microphone-close",id:E(_)})},qo=async()=>{if(L)throw new c("HOST_REJECTED","The microphone is already open in this frame.");if(d?.features?.microphone!==!0)throw new c("UNSUPPORTED","This OpenChamber cannot share the microphone with extensions.");let t=globalThis.AudioContext;if(typeof t!="function")throw new c("UNSUPPORTED","This frame has no Web Audio.");let o=new t;if(o.sampleRate<8e3||o.sampleRate>192e3)throw o.close().catch(()=>{}),new c("UNSUPPORTED",`Audio at ${o.sampleRate} Hz is not supported.`);let a=o.state==="suspended"?o.resume().catch(()=>{}):void 0,i=Jt(Math.round(o.sampleRate/4)),S=o.createScriptProcessor(1024,1,1);S.onaudioprocess=w=>i.pull(w.outputBuffer.getChannelData(0));let f=o.createMediaStreamDestination();S.connect(f);let R=new Set,Z={queue:i,endedListeners:R,release:()=>{S.onaudioprocess=null,S.disconnect(),i.clear();for(let w of f.stream.getTracks())w.stop();o.close().catch(()=>{})}};L=Z;try{let w=await C({...m,type:"microphone-open",id:E(_),payload:{sampleRate:o.sampleRate}},12e4);if(!w||!("opened"in w)||w.opened!==!0)throw new c("HOST_REJECTED","Host did not open the microphone.");if(await a,L!==Z)throw new c("DISCONNECTED","The microphone closed while it was opening.")}catch(w){throw L===Z&&(L=null),Z.release(),We(),w}return{stream:f.stream,close:()=>{L===Z&&(L=null,Z.release(),We())},onEnded:w=>(R.add(w),()=>{R.delete(w)})}},Vt=t=>{!Mo(t)||!ar(t)||(t.preventDefault(),$t())},Ft=t=>{!Mo(t)||t.key!=="Escape"||d?.surface!=="popover"||!d.popover||(t.preventDefault(),jt(d.popover.id,"escape").catch(()=>{}))},me=()=>{let t=d?.surface==="popover"?d.popover:void 0;if(!t)return;let o=le||_e;Gt!==o&&(Gt=o,zt(t.id,o).catch(()=>{}))},Ie=()=>{d?.surface!=="popover"||le||(le=!0,me())},Bt=t=>{d?.surface!=="popover"||t.relatedTarget!==null||!le||(le=!1,me())},Kt=()=>{d?.surface!=="popover"||_e||(_e=!0,me())},Wt=()=>{d?.surface!=="popover"||!_e||(_e=!1,me())},D=(t,o=1024)=>{if(!t.trim()||t.length>o)throw new c("HOST_REJECTED",`Identity must contain 1 to ${o} characters.`)},je=async t=>{t.kind!=="projects"&&D(t.projectId);let o=await C({...m,type:"workspace-read",id:E(_),payload:t});if(!o||!("kind"in o)||!("state"in o)||o.kind!==t.kind)throw new c("HOST_REJECTED","Host did not return workspace data.");return o},ze=async(t,o)=>{t.kind!=="projects"&&D(t.projectId);let a=E(_);Y.set(a,o);try{await g({...m,type:"workspace-subscribe",id:E(_),payload:{subscriptionId:a,query:t}})}catch(i){throw Y.delete(a),G||M({...m,type:"workspace-unsubscribe",id:E(_),payload:{subscriptionId:a}}),i}return()=>{!Y.delete(a)||G||M({...m,type:"workspace-unsubscribe",id:E(_),payload:{subscriptionId:a}})}},Jo=async(t,o)=>{t.kind==="session"&&D(t.sessionId),t.kind==="project"&&D(t.projectId);let a=E(_);Q.set(a,o);try{await g({...m,type:"shells-subscribe",id:E(_),payload:{subscriptionId:a,scope:t}})}catch(i){throw Q.delete(a),G||M({...m,type:"shells-unsubscribe",id:E(_),payload:{subscriptionId:a}}),i}return()=>{!Q.delete(a)||G||M({...m,type:"shells-unsubscribe",id:E(_),payload:{subscriptionId:a}})}},xe=async t=>{if("key"in t&&(t.key.length===0||t.key.length>128))throw new c("HOST_REJECTED","Storage key must contain 1 to 128 characters.");if(t.op==="set"&&!ee(t.value))throw new c("HOST_REJECTED","Storage values must be JSON.");if(t.op==="set"&&new TextEncoder().encode(JSON.stringify(t.value)).length>65536)throw new c("HOST_REJECTED","Storage value exceeds 64 KiB.");if(t.scope==="device"&&d?.features?.deviceStorage!==!0)throw new c("UNSUPPORTED","This host does not support device storage.");let o=await C({...m,type:"storage",id:E(_),payload:t});if(!o||!("storage"in o)||o.op!==t.op)throw new c("HOST_REJECTED","Host did not return storage data.");return o},jt=(t,o)=>d?.features?.popovers!==!0&&!(d?.surface==="popover"&&d.popover?.id===t)?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):g({...m,type:"popover-close",id:E(_),payload:o?{id:t,reason:o}:{id:t}}),zt=(t,o)=>d?.features?.popovers!==!0&&!(d?.surface==="popover"&&d.popover?.id===t)?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):g({...m,type:"popover-anchor",id:E(_),payload:{id:t,active:o}});return r.addEventListener("keydown",Ft,!0),r.addEventListener("pointerover",Ie),r.addEventListener("pointermove",Ie),r.addEventListener("pointerout",Bt),r.addEventListener("focus",Kt),r.addEventListener("blur",Wt),{onAction:t=>(ae=t,()=>{ae===t&&(ae=null)}),listProjects:async()=>{let t=await je({kind:"projects"});if(t.kind!=="projects")throw new c("HOST_REJECTED","Expected projects.");return t},listWorktrees:async t=>{let o=await je({kind:"worktrees",projectId:t});if(o.kind!=="worktrees")throw new c("HOST_REJECTED","Expected worktrees.");return o},listSessions:async t=>{let o=await je({kind:"sessions",projectId:t});if(o.kind!=="sessions")throw new c("HOST_REJECTED","Expected sessions.");return o},onProjects:t=>ze({kind:"projects"},o=>{o.kind==="projects"&&t(o)}),onWorktrees:(t,o)=>ze({kind:"worktrees",projectId:t},a=>{a.kind==="worktrees"&&o(a)}),onSessions:(t,o)=>ze({kind:"sessions",projectId:t},a=>{a.kind==="sessions"&&o(a)}),onRunningShells:(t,o)=>Jo(t,o),readShellOutput:async(t,o)=>{D(t,128);let a=o?.cursor;if(a!==void 0&&(!Number.isInteger(a)||a<0))throw new c("HOST_REJECTED","Shell output cursor must be a non-negative integer.");let i=o?.tailBytes;if(i!==void 0&&(!Number.isInteger(i)||i<1||i>65536))throw new c("HOST_REJECTED",`Shell output tailBytes must be an integer between 1 and ${65536}.`);let f=await C({...m,type:"shell-output",id:E(_),payload:{shellId:t,cursor:a,tailBytes:i}});if(!f||typeof f.output!="string"||!Number.isFinite(f.cursor))throw new c("HOST_REJECTED","Host did not return shell output.");return f},stopShell:async t=>{if(D(t,128),(await C({...m,type:"shell-stop",id:E(_),payload:{shellId:t}}))?.stopped!==!0)throw new c("HOST_REJECTED","Host did not stop the shell.");return{stopped:!0}},openSession:async t=>{D(t),await g({...m,type:"open-session",id:E(_),payload:{sessionId:t}})},storage:{get:async(t,o)=>{let a=Pe(o),i={op:"get",key:t};a&&(i.scope=a);let S=await xe(i);return S.op==="get"&&S.found?S.value:void 0},set:async(t,o,a)=>{let i=Pe(a),S={op:"set",key:t,value:o};i&&(S.scope=i),await xe(S)},delete:async(t,o)=>{let a=Pe(o),i={op:"delete",key:t};a&&(i.scope=a),await xe(i)},keys:async t=>{let o=Pe(t),a={op:"keys"};o&&(a.scope=o);let i=await xe(a);if(i.op!=="keys")throw new c("HOST_REJECTED","Expected storage keys.");return i.keys}},onReady:t=>(l.add(t),d&&t(d),()=>{l.delete(t)}),onDirectory:t=>(A.add(t),d&&t(d.directory),()=>{A.delete(t)}),onSession:t=>(k.add(t),d&&t(d.session),()=>{k.delete(t)}),onSessionLifecycle:t=>(b.add(t),V&&t(V),()=>{b.delete(t)}),onConnection:t=>(H.add(t),d&&t(d.connection),()=>{H.delete(t)}),onSettings:t=>(X.add(t),d&&t(d.settings),()=>{X.delete(t)}),onItem:t=>($.add(t),d&&t(d.item),()=>{$.delete(t)}),onBlock:t=>(Se.add(t),d?.block&&t(d.block),()=>{Se.delete(t)}),onServiceEvent:t=>(fe.add(t),()=>{fe.delete(t)}),onStatusControl:t=>(Ae.add(t),()=>{Ae.delete(t)}),onPopoverClosed:t=>(Oe.add(t),()=>{Oe.delete(t)}),setStatusControls:t=>d?.features?.statusControls!==!0?Promise.reject(new c("UNSUPPORTED","This host does not support status controls.")):to(t)?g({...m,type:"status-controls",id:E(_),payload:{controls:t}}):Promise.reject(new c("HOST_REJECTED","Status controls must have unique bounded ids and valid selected options.")),openPopover:t=>d?.features?.popovers!==!0?Promise.reject(new c("UNSUPPORTED","This host does not support popovers.")):Ze(t)?g({...m,type:"popover-open",id:E(_),payload:t}):Promise.reject(new c("HOST_REJECTED","Popover requests need bounded geometry and JSON data.")),closePopover:jt,setPopoverAnchorActive:zt,onResolve:t=>(ie=t,()=>{ie===t&&(ie=null)}),toast:t=>{let o=t.message.trim();return!o||o.length>be?Promise.reject(new c("HOST_REJECTED",`Toast message must contain 1 to ${be} characters.`)):t.copy&&t.copy!==!0&&(!t.copy.text.length||t.copy.text.length>ke)?Promise.reject(new c("HOST_REJECTED",`Toast copy text must contain 1 to ${ke} characters.`)):g({channel:u,v:1,type:"toast",id:E(_),payload:{...t,message:o}})},openUrl:t=>g({channel:u,v:1,type:"open-url",id:E(_),payload:{url:t}}),..._o(g,()=>E(_),t=>Promise.reject(new c("HOST_REJECTED",t))),answerBlock:t=>g({channel:u,v:1,type:"block-answer",id:E(_),payload:{text:t.trim().slice(0,ot)}}),openSurface:t=>g({channel:u,v:1,type:"open-surface",id:E(_),payload:{surfaceId:t}}),writeClipboard:t=>g({channel:u,v:1,type:"clipboard-write",id:E(_),payload:{text:t}}),compose:t=>g({channel:u,v:1,type:"compose",id:E(_),payload:t}),attach:t=>g({channel:u,v:1,type:"attach",id:E(_),payload:te(t)}),startSession:async t=>{t.projectId!==void 0&&D(t.projectId);let o=t.worktree;o&&o!==!0&&(o.kind==="existing"?D(o.directory):(o.name!==void 0&&D(o.name,200),o.baseBranch!==void 0&&D(o.baseBranch,200)));let a=await C({channel:u,v:1,type:"start-session",id:E(_),payload:ct(t)},e.requestTimeoutMs??18e4);if(!rt(a))throw new c("HOST_REJECTED","Host did not return a session.");return a},prompt:t=>C({channel:u,v:1,type:"prompt",id:E(_),payload:dt(t)}).then(o=>{if(!nt(o))throw new c("HOST_REJECTED","Host did not return a prompt result.");return o}),sessionLink:t=>g({channel:u,v:1,type:"session-link",id:E(_),payload:te(t)}),close:()=>g({channel:u,v:1,type:"close",id:E(_)}),oauthStart:()=>g({channel:u,v:1,type:"oauth-start",id:E(_)}),oauthDisconnect:()=>g({channel:u,v:1,type:"oauth-disconnect",id:E(_)}),request:t=>(Ne(t.path)?C({channel:u,v:1,type:"request",id:E(_),payload:t}):yo()).then(o=>{if(!ve(o))throw new c("HOST_REJECTED","Host request result was empty.");return o}),serviceRequest:t=>(Ne(t.path)?C({channel:u,v:1,type:"service-request",id:E(_),payload:t}):yo()).then(o=>{if(!ve(o))throw new c("HOST_REJECTED","Host service request result was empty.");return o}),serviceStatus:()=>C({channel:u,v:1,type:"service-status",id:E(_)}).then(t=>{if(!Et(t))throw new c("HOST_REJECTED","Host did not return service status.");return t}),readFile:t=>(oe(t)?C({channel:u,v:1,type:"file-read",id:E(_),payload:{path:t}}):Le()).then(o=>{if(!pt(o))throw new c("HOST_REJECTED","Host did not return file content.");return o}),writeFile:(t,o)=>oe(t)?o.length>Ue?Promise.reject(new c("FILE_TOO_LARGE",`Content is over ${Ue} characters.`)):C({channel:u,v:1,type:"file-write",id:E(_),payload:{path:t,content:o}}).then(a=>{if(!ut(a))throw new c("HOST_REJECTED","Host did not confirm the write.");return a}):Le(),listDir:t=>(oe(t)?C({channel:u,v:1,type:"file-list",id:E(_),payload:{path:t}}):Le()).then(o=>{if(!Tt(o))throw new c("HOST_REJECTED","Host did not return directory entries.");return o}),stat:t=>(oe(t)?C({channel:u,v:1,type:"file-stat",id:E(_),payload:{path:t}}):Le()).then(o=>{if(!St(o))throw new c("HOST_REJECTED","Host did not return file status.");return o}),generate:t=>{let o=t.prompt.trim(),a=t.system?.trim();if(o.length===0||o.length>Me)return Promise.reject(new c("HOST_REJECTED",`Prompt must be 1 to ${Me} characters.`));if(a!==void 0&&(a.length===0||a.length>ye))return Promise.reject(new c("HOST_REJECTED",`System prompt must be 1 to ${ye} characters.`));let i=t.maxOutputTokens===void 0?void 0:Math.min(it,Math.max(1,Math.floor(t.maxOutputTokens)));if(i!==void 0&&!Number.isFinite(i))return Promise.reject(new c("HOST_REJECTED","maxOutputTokens must be a number."));let S={prompt:o};return a!==void 0&&(S.system=a),i!==void 0&&(S.maxOutputTokens=i),C({channel:u,v:1,type:"generate",id:E(_),payload:S},e.requestTimeoutMs??at).then(f=>{if(!ft(f))throw new c("HOST_REJECTED","Host did not return generated text.");return f})},onLateGenerateResult:t=>{q.add(t);for(let o of Fe.splice(0))O([t],o);return Ht(),()=>{q.delete(t)}},openMicrophone:qo,setBadge:t=>g({channel:u,v:1,type:"badge",id:E(_),payload:{count:lt(t)}}),setHeight:t=>g({channel:u,v:1,type:"resize",id:E(_),payload:{height:_t(t)}}),onFileOpen:t=>(Re.add(t),Be||(Be=!0,r.addEventListener("keydown",Vt,!0)),de&&t(de),()=>{Re.delete(t)}),onFileSnapshot:t=>(ce=t,()=>{ce===t&&(ce=null)}),onFileSaved:t=>(he.add(t),()=>{he.delete(t)}),reportFileChange:t=>Ke({...m,type:"file-change",payload:{dirty:t.dirty,edited:t.edited}}),requestFileSave:$t,reportFileUnsupported:()=>Ke({...m,type:"file-unsupported"}),dispose:()=>{for(let t of Y.keys())M({...m,type:"workspace-unsubscribe",id:E(_),payload:{subscriptionId:t}});Y.clear();for(let t of Q.keys())M({...m,type:"shells-unsubscribe",id:E(_),payload:{subscriptionId:t}});Q.clear(),L&&(We(),L.release(),L=null),G=!0,ie=null,ae=null,ce=null,Re.clear(),he.clear(),Be&&r.removeEventListener("keydown",Vt,!0),r.removeEventListener("message",Xt),r.removeEventListener("keydown",Ft,!0),r.removeEventListener("pointerover",Ie),r.removeEventListener("pointermove",Ie),r.removeEventListener("pointerout",Bt),r.removeEventListener("focus",Kt),r.removeEventListener("blur",Wt);for(let t of J.values())clearTimeout(t.timer),t.reject(new c("HOST_UNAVAILABLE","Host client was disposed."));J.clear(),l.clear(),A.clear(),k.clear(),b.clear(),H.clear(),X.clear(),$.clear(),Se.clear(),fe.clear(),Ae.clear(),Oe.clear(),q.clear(),Fe.length=0}}};var Go=["browser.open","browser.snapshot","browser.click","browser.type","browser.select","browser.scroll","browser.back","browser.forward","browser.inspect","browser.capture","browser.resize","browser.close"];var sn=new Set(Go);var cr=10*6e4;var dr=10*6e4;var lr=10*6e4;var _r=10*6e4;var Do=["none","agent","user"];var cn=new Set(Do);var Er=[["--oc-bg","background"],["--oc-elevated","elevated"],["--oc-fg","foreground"],["--oc-muted","muted"],["--oc-subtle","subtle"],["--oc-border","border"],["--oc-hover","hover"],["--oc-selection","selection"],["--oc-focus","focus"],["--oc-primary","primary"],["--oc-muted-surface","mutedSurface"],["--oc-elevated-fg","elevatedForeground"],["--oc-active","active"],["--oc-selection-fg","selectionForeground"],["--oc-primary-fg","primaryForeground"],["--oc-primary-text","primaryText"],["--oc-success-text","successText"],["--oc-warning-text","warningText"],["--oc-error-text","errorText"],["--oc-info-text","infoText"],["--oc-success","success"],["--oc-warning","warning"],["--oc-error","error"],["--oc-info","info"],["--oc-font","font"],["--oc-mono","mono"],["--oc-radius","radius"],["--surface-background","background"],["--surface-elevated","elevated"],["--surface-foreground","foreground"],["--surface-muted-foreground","muted"],["--surface-subtle","subtle"],["--interactive-border","border"],["--interactive-hover","hover"],["--interactive-selection","selection"],["--interactive-focus-ring","focus"],["--primary","primary"],["--surface-muted","mutedSurface"],["--surface-elevated-foreground","elevatedForeground"],["--interactive-active","active"],["--interactive-selection-foreground","selectionForeground"],["--primary-foreground","primaryForeground"],["--primary-text","primaryText"],["--success-text","successText"],["--warning-text","warningText"],["--error-text","errorText"],["--info-text","infoText"],["--status-success","success"],["--status-warning","warning"],["--status-error","error"],["--status-info","info"],["--font-sans","font"],["--font-mono","mono"],["--radius","radius"]],pr=[["--oc-syntax-keyword","--syntax-keyword","syntaxKeyword"],["--oc-syntax-string","--syntax-string","syntaxString"],["--oc-syntax-number","--syntax-number","syntaxNumber"],["--oc-syntax-function","--syntax-function","syntaxFunction"],["--oc-syntax-type","--syntax-type","syntaxType"],["--oc-syntax-comment","--syntax-comment","syntaxComment"],["--oc-syntax-variable","--syntax-variable","syntaxVariable"],["--oc-syntax-operator","--syntax-operator","syntaxOperator"]],Ho=(e,r)=>{r.style.colorScheme=e.mode;for(let[s,p]of Er)r.style.setProperty(s,e.tokens[p]);for(let[s,p,l]of pr){let A=e.tokens[l]??"";r.style.setProperty(s,A),r.style.setProperty(p,A)}r.style.setProperty("font-family",e.tokens.font),r.style.setProperty("font-size",e.tokens.fontSize??"0.875rem"),r.style.setProperty("line-height","1.45"),r.style.setProperty("color",e.tokens.foreground)},xt=(e,r)=>{Ho(e.theme,r),r.dataset&&(r.dataset.ocSurface=e.surface,r.dataset.ocTheme=e.theme.mode)};var ur={"surface-background":"bg","surface-elevated":"elevated","surface-elevated-foreground":"elevated-fg","surface-foreground":"fg","surface-muted-foreground":"muted","surface-muted":"muted-surface","surface-subtle":"subtle","interactive-border":"border","interactive-hover":"hover","interactive-active":"active","interactive-selection":"selection","interactive-selection-foreground":"selection-fg","interactive-focus-ring":"focus",primary:"primary","primary-foreground":"primary-fg","primary-text":"primary-text","success-text":"success-text","warning-text":"warning-text","error-text":"error-text","info-text":"info-text","status-success":"success","status-warning":"warning","status-error":"error","status-info":"info","font-sans":"font","font-mono":"mono",radius:"radius"},h=(e,r)=>`var(--${e}, var(--oc-${ur[e]}, ${r}))`,B=h("surface-background","transparent"),Ge=h("surface-elevated","transparent"),re=h("surface-elevated-foreground","inherit"),P=h("surface-foreground","inherit"),I=h("surface-muted-foreground","gray"),Tr=h("surface-muted","transparent"),j=h("interactive-border","currentColor"),y=h("interactive-hover","transparent"),z=h("interactive-active","transparent"),gt=h("interactive-selection","transparent"),bt=h("interactive-selection-foreground","inherit"),F=h("primary","currentColor"),kt=h("primary-text","inherit"),Ct=h("error-text","inherit"),Sr=h("font-sans","inherit"),Ut=h("font-mono","monospace"),Fo=h("radius","9px"),Mt=`calc(${Fo} - 2px)`,Xo=`calc(${Fo} - 4px)`,x=(e,r,s="transparent")=>`color-mix(in srgb, ${e} ${r}%, ${s})`,$o=`background-image: linear-gradient(${y}, ${y});`,yt=(e,r="0.5px")=>`box-shadow: inset 0 0 0 ${r} ${e}, var(--oc-sdk-field-lift);`,Nt="border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);",Vo="box-shadow: var(--oc-sdk-lit);",vt=`inset 0 0.5px 0 0 ${x(P,8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`,fr=`
:root {
  --oc-sdk-edge: ${x(P,16)};
  --oc-sdk-field-bg: ${Ge};
  --oc-sdk-raised-bg: ${B};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${x(P,14)};
  --oc-sdk-field-bg: ${x(B,50,Ge)};
  --oc-sdk-raised-bg: ${Ge};
  --oc-sdk-field-lift: ${vt};
  --oc-sdk-raised-lift: ${vt};
  --oc-sdk-lit: ${vt};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`,we=e=>{let r=h(`status-${e}`,"currentColor");return`
.oc-sdk[data-tone="${e}"], .oc-sdk [data-tone="${e}"] { --oc-sdk-tone: ${r}; --oc-sdk-tone-text: ${h(`${e}-text`,"inherit")}; }`},n=e=>`calc(${e}rem / 14)`,Ar=`
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
`,Bo=`${fr}
.oc-sdk { color: ${P}; font-family: ${Sr}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${$o} }
.oc-sdk-mono { font-family: ${Ut}; }
.oc-sdk-muted { color: ${I}; }
${we("success")}${we("warning")}${we("error")}${we("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${F}; --oc-sdk-tone-text: ${kt}; }

.oc-sdk-btn { border-radius: ${Mt}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${Xo}; }
.oc-sdk-btn[data-variant="default"] { color: ${kt}; background: ${x(F,10,B)}; border-color: ${x(F,12)}; ${Vo} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${x(F,16,B)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${x(F,22,B)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${Tr}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${z}, ${z}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${re}; ${Nt} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${z}, ${z}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${y}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${z}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${h("status-error","red")}; color: ${Ct}; background: ${x("var(--oc-sdk-tone)",7,B)}; border-color: ${x("var(--oc-sdk-tone)",12)}; ${Vo} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${x("var(--oc-sdk-tone)",9,B)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${x("var(--oc-sdk-tone)",11,B)}; box-shadow: none; }

.oc-sdk-field-note { color: ${I}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${Ct}; }
.oc-sdk-input { border-radius: ${Mt}; background: var(--oc-sdk-field-bg); color: ${re}; ${yt("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${I}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${yt(x(P,26),"1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${yt(h("status-error","red"),"1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${Ut}; }

.oc-sdk-search-icon { color: ${I}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${F}; }
.oc-sdk-search-clear { border-radius: ${Xo}; color: ${I}; }
.oc-sdk-search-clear:hover { background: ${y}; color: ${P}; }

.oc-sdk-trigger { border-radius: ${Mt}; background: var(--oc-sdk-raised-bg); color: ${re}; ${Nt} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${y}, ${y}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${z}, ${z}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${I}; }
.oc-sdk-trigger-chevron { color: ${I}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${re}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${Ge}; background-clip: padding-box; color: ${re}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${y}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${gt}; color: ${bt}; }
.oc-sdk-option-check { color: ${P}; }
.oc-sdk-option[data-destructive="true"] { color: ${Ct}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${x(h("status-error","red"),10)}; }
.oc-sdk-option-hint { color: ${I}; }
.oc-sdk-popup-empty { color: ${I}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${j}; border-radius: 4px; color: ${P}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${x(P,60,j)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${j}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${B}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${F}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${$o} }
.oc-sdk-check-desc { color: ${I}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${x(P,4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${I}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${P}; }
.oc-sdk-tab[aria-selected="true"] { color: ${bt}; background: ${gt}; border-color: ${j}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${re}; background: var(--oc-sdk-raised-bg); ${Nt} }
.oc-sdk-tab-count { color: ${I}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${x(P,6)}; color: ${I}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${x("var(--oc-sdk-tone)",15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${y}; }
.oc-sdk-row[aria-selected="true"] { background: ${gt}; color: ${bt}; }
.oc-sdk-row-lead { font-family: ${Ut}; color: ${I}; }
.oc-sdk-row-sub { color: ${I}; }
.oc-sdk-row-meta { color: ${I}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${I}; }

.oc-sdk-empty-body { color: ${I}; }

.oc-sdk-spinner { color: ${I}; }
.oc-sdk-spinner-ring { border-color: ${j}; border-top-color: ${F}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${x("var(--oc-sdk-tone)",10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${I}; }

.oc-sdk-separator { color: ${I}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${x(j,40)}; }

.oc-sdk-progress-label { color: ${I}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${x(P,6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${F}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${h("status-success","currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${h("success-text","inherit")}; }

.oc-sdk-text a { color: ${kt}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${x(j,60)}; }
`,U=`
${qe}
${Ar}
${Bo}`;var Te=It(),Wo=document.querySelector("#directory"),Ko=document.querySelector("#notice"),ue=document.querySelector("#hosts"),Ve=document.querySelector("#config"),Pt=document.querySelector("#result"),Ir=document.querySelector("#reload"),xr=document.querySelector("#save"),se=null;function W(e,r="info"){Ko.className=r==="error"?"error":r==="success"?"ok":"",Ko.textContent=e}function gr(e){Pt.hidden=!1,Pt.textContent=typeof e=="string"?e:JSON.stringify(e,null,2)}async function br(e,r){if(!se)throw new Error("Open a project first.");let s=await Te.serviceRequest({method:"POST",path:e,body:JSON.stringify({...r,directory:se})}),p=JSON.parse(s.body||"{}");if(s.status<200||s.status>=300||p.ok===!1)throw new Error(p.error?.message??`Fleet service returned HTTP ${s.status}`);return p.result??p}function jo(e){let r=JSON.parse(e);if(!r||typeof r.name!="string"||!r.name||!r.hosts||typeof r.hosts!="object")throw new Error("fleet.json needs a non-empty name and a hosts object.");return r}function zo(e){ue.replaceChildren();for(let[r,s]of Object.entries(e.hosts)){let p=document.createElement("div");p.className="host";let l=document.createElement("div");l.className="row";let A=document.createElement("strong");A.textContent=r;let k=document.createElement("small");k.textContent=s.ssh,l.append(A,k);let b=document.createElement("div");b.className="row",b.style.marginTop="8px";for(let[H,X]of[["Status","status"],["Plan","plan"],["Recovery","recovery"]]){let $=document.createElement("button");$.textContent=H,$.dataset.action=X,$.dataset.host=r,b.append($)}p.append(l,b),ue.append(p)}}async function wt(){W("Loading Fleet configuration\u2026");try{let e=await Te.readFile("fleet.json");Ve.value=e.content;let r=jo(e.content);zo(r),W(`${Object.keys(r.hosts).length} configured host(s).`,"success")}catch(e){Ve.value="",ue.replaceChildren(),e instanceof c&&/not found/i.test(e.message)?W("No fleet.json in this project. Create one below or run fleet init."):W(e instanceof Error?e.message:String(e),"error")}}Te.onReady(e=>{xt(e,document.documentElement),se=e.directory,Wo.textContent=se??"Open a project to load its fleet.json.",se&&wt()});Te.onDirectory(e=>{se=e,Wo.textContent=e??"Open a project to load its fleet.json.",Pt.hidden=!0,e?wt():(Ve.value="",ue.replaceChildren())});Ir.addEventListener("click",()=>void wt());xr.addEventListener("click",()=>{(async()=>{try{let e=jo(Ve.value);await Te.writeFile("fleet.json",`${JSON.stringify(e,null,2)}
`),zo(e),W("fleet.json saved.","success")}catch(e){W(e instanceof Error?e.message:String(e),"error")}})()});ue.addEventListener("click",e=>{let r=e.target.closest("button[data-action]");if(!r)return;let s=r.dataset.action,p=r.dataset.host;!s||!p||(r.disabled=!0,W(`${s} on ${p}\u2026`),(async()=>{try{gr(await br(s==="status"?"/status":s==="plan"?"/plan":"/recovery",{host:p})),W(`${s} completed.`,"success")}catch(l){W(l instanceof Error?l.message:String(l),"error")}finally{r.disabled=!1}})())});})();
