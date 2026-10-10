import * as THREE from 'three';

export function createSaltAvatar(canvas) {
  let renderer;
  try { renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'}); }
  catch { canvas.closest('.avatar-stage')?.classList.add('avatar-fallback');return { setMode(){},dispose(){} }; }
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);renderer.setClearColor(0x000000,0);
  const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(34,canvas.clientWidth/canvas.clientHeight,.1,100);camera.position.set(0,0,7);
  scene.add(new THREE.HemisphereLight(0xe2ffd0,0x111811,2.2));const keyLight=new THREE.PointLight(0xd4ff9c,34,14);keyLight.position.set(3,4,5);scene.add(keyLight);const fill=new THREE.PointLight(0x58b8ad,18,12);fill.position.set(-3,-1,4);scene.add(fill);
  const head=new THREE.Group();scene.add(head);
  const shell=new THREE.Mesh(new THREE.SphereGeometry(1.2,48,32),new THREE.MeshPhysicalMaterial({color:0x263329,metalness:.43,roughness:.24,clearcoat:.9,clearcoatRoughness:.1}));head.add(shell);
  const face=new THREE.Group();face.position.set(0,.02,1.01);head.add(face);
  const eyeMat=new THREE.MeshStandardMaterial({color:0xd8f4b5,emissive:0x769a3c,emissiveIntensity:1.8,roughness:.25});
  for(const x of [-.39,.39]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.115,20,16),eyeMat);eye.position.set(x,.1,.11);face.add(eye);const pupil=new THREE.Mesh(new THREE.SphereGeometry(.044,16,12),new THREE.MeshBasicMaterial({color:0x172117}));pupil.position.set(x,.1,.207);face.add(pupil);}
  const mouth=new THREE.Mesh(new THREE.BoxGeometry(.31,.035,.06),new THREE.MeshStandardMaterial({color:0xc3ec8e,emissive:0x547d23,emissiveIntensity:1.3}));mouth.position.set(0,-.29,.14);face.add(mouth);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(1.52,.022,8,128),new THREE.MeshBasicMaterial({color:0x99ca69,transparent:true,opacity:.8}));halo.rotation.set(.56,.25,.3);head.add(halo);
  const orbit=new THREE.Mesh(new THREE.TorusGeometry(1.7,.008,6,128),new THREE.MeshBasicMaterial({color:0x62c6b9,transparent:true,opacity:.53}));orbit.rotation.set(1.08,-.4,.2);head.add(orbit);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(1.38,48),new THREE.MeshBasicMaterial({color:0x132019,transparent:true,opacity:.55}));floor.position.set(0,-1.72,-.3);floor.scale.set(1.2,.24,1);scene.add(floor);
  let mode='idle',pointerX=0,pointerY=0,disposed=false;const clock=new THREE.Clock();
  const resize=()=>{if(disposed)return;const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  canvas.addEventListener('pointermove',event=>{const rect=canvas.getBoundingClientRect();pointerX=(event.clientX-rect.left)/rect.width-.5;pointerY=(event.clientY-rect.top)/rect.height-.5;});
  renderer.setAnimationLoop(()=>{if(disposed)return;const t=clock.getElapsedTime();head.position.y=Math.sin(t*1.2)*.07;head.rotation.y+=(pointerX*.48+Math.sin(t*.4)*.12-head.rotation.y)*.025;head.rotation.x+=(-pointerY*.22+Math.sin(t*.7)*.025-head.rotation.x)*.025;halo.rotation.z=t*.14;orbit.rotation.y=-.4+Math.sin(t*.35)*.24;const talking=mode==='speaking',listening=mode==='listening';shell.material.emissive.setHex(listening?0x162c13:talking?0x263319:0x080d09);shell.material.emissiveIntensity=(listening?1.2:talking?.8:.35)+Math.sin(t*3)*(listening?.35:.08);mouth.scale.y=talking?1+Math.abs(Math.sin(t*13))*9:1;halo.material.opacity=listening?.95:.67+Math.sin(t*2)*.12;renderer.render(scene,camera);});
  return {setMode(value){mode=value},dispose(){disposed=true;observer.disconnect();renderer.setAnimationLoop(null);renderer.dispose();scene.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(m=>m.dispose());else object.material?.dispose()})}};
}
