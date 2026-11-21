'use strict';
// Keep binary images out of the JSON text for both successful controls and refusals.
function present(response){
 const image=response.ok?response.value?.image:response.image;
 if(!image)return {content:[{type:'text',text:JSON.stringify(response)}],isError:response.ok!==true};
 const metadata={...response};
 if(response.value){metadata.value={...response.value};delete metadata.value.image;}
 delete metadata.image;
 return {content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',mimeType:image.mimeType,data:image.data}],isError:response.ok!==true};
}
module.exports={present};
