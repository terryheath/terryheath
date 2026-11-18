(function(){
  document.addEventListener('submit',function(ev){
    var f=ev.target; if(!f.matches||!f.matches('[data-ih-signup]')) return;
    ev.preventDefault();
    var msg=f.querySelector('.ih-msg'), btn=f.querySelector('button[type=submit]');
    btn.disabled=true; msg.textContent='Sending…';
    fetch(f.action,{method:'POST',headers:{Accept:'application/json'},body:new FormData(f)})
      .then(function(r){return r.json();})
      .then(function(j){msg.textContent=j.message||(j.ok?'Thank you.':'Something went wrong.'); if(j.ok) f.reset();})
      .catch(function(){msg.textContent='Something went wrong. Please try again.';})
      .then(function(){btn.disabled=false;});
  });
})();
