(function(){
  function T(k,d){ return (window.IH_T&&window.IH_T[k])||d; }
  document.addEventListener('submit',function(ev){
    var f=ev.target; if(!f.matches||!f.matches('[data-ih-signup]')) return;
    ev.preventDefault();
    var msg=f.querySelector('.ih-msg'), btn=f.querySelector('button[type=submit]');
    btn.disabled=true; msg.textContent=T('js.sending','Sending…');
    fetch(f.action,{method:'POST',headers:{Accept:'application/json'},body:new FormData(f)})
      .then(function(r){return r.json();})
      .then(function(j){msg.textContent=j.message||(j.ok?T('js.thanks','Thank you.'):T('js.wrong','Something went wrong.')); if(j.ok) f.reset();})
      .catch(function(){msg.textContent=T('js.wrong_retry','Something went wrong. Please try again.');})
      .then(function(){btn.disabled=false;});
  });
})();
(function(){
  // welcome band: shown on a first visit, gone for good once dismissed (stored in this browser only)
  var b=document.querySelector('[data-ih-welcome]'); if(!b) return;
  var gone=false; try{gone=localStorage.getItem('ih_welcome')==='1';}catch(e){}
  if(!gone) b.hidden=false;
  var x=b.querySelector('.ih-welcome-x'); if(x) x.addEventListener('click',function(){b.hidden=true; try{localStorage.setItem('ih_welcome','1');}catch(e){}});
})();
(function(){
  // "Play episode": the player appears in place of the button and starts
  document.addEventListener('click',function(ev){
    var b=ev.target.closest&&ev.target.closest('[data-ih-audio]'); if(!b) return;
    var a=document.createElement('audio'); a.controls=true; a.autoplay=true; a.src=b.getAttribute('data-ih-audio'); a.style.maxWidth='100%';
    b.parentNode.insertBefore(a,b); b.hidden=true;
  });
})();
