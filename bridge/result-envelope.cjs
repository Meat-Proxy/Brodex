'use strict';
// Additive contract: existing consumers may continue reading the error string.
function failure(error, phase='operation', dispatchState='unknown') {
 if(dispatchState==='unknown'&&error?.dispatch_state==='not_dispatched')dispatchState='not_dispatched';
 const message=String(error?.message||error||'UNKNOWN_ERROR').replace(/^(?:DEBUGGER_OPERATION_FAILED:\s*)+/, '');
 const code=(message.match(/^[A-Z][A-Z0-9_]{2,70}(?=:|$)/)||[])[0]||'UNCLASSIFIED_ERROR';
 return {ok:false,error:message,error_info:{code,phase,dispatch_state:dispatchState,retry_action:false,next_step:dispatchState==='not_dispatched'?'inspect_and_prepare':'inspect_outcome'}};
}
function normalize(response){
 if(response?.ok===false&&!response.error_info)return {...response,...failure(response.error,'operation',response.dispatch_state==='not_dispatched'?'not_dispatched':'unknown')};
 return response;
}
function workflowFailure(error){
 // These commands never dispatch a browser action. A storage error may still
 // leave the metadata write uncertain: inspect the journal, not the page.
 const result=failure(error,'workflow','not_dispatched');
 result.browser_action_executed=false;
 if(error?.validation)result.validation=error.validation;
 if(error?.chain)result.chain=error.chain;
 result.error_info.next_step='inspect_task_progress';
 return result;
}
module.exports={failure,normalize,workflowFailure};
