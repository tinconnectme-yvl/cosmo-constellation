// A single GPU draw call. The surface is cached until the camera changes.
export class EarthSurface {
 constructor(onReady=()=>{}) {
  this.canvas=document.createElement('canvas');
  this.gl=this.canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:true});
  this.ready=false;if(!this.gl)return;
  const g=this.gl;
  const vertex='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fragment=`precision highp float;uniform vec2 size;uniform float radius;uniform vec2 center;uniform sampler2D earth;const float PI=3.14159265359;
  void main(){vec2 p=(gl_FragCoord.xy-size*.5)/radius;float d=length(p);if(d>1.12){gl_FragColor=vec4(0.);return;}vec3 blue=vec3(.25,.59,1.);if(d>1.){float a=exp(-(d-1.)*55.)*.45;gl_FragColor=vec4(blue*a,a);return;}float z=sqrt(max(0.,1.-dot(p,p)));float lat=asin(clamp(p.y*cos(center.x)+z*sin(center.x),-1.,1.));float lon=center.y+atan(p.x,z*cos(center.x)-p.y*sin(center.x));vec2 uv=vec2(fract(lon/(2.*PI)+.5),.5-lat/PI);vec3 col=texture2D(earth,uv).rgb;vec3 normal=vec3(p,z);float light=dot(normal,normalize(vec3(-.75,.45,1.)));float daylight=smoothstep(-.12,.55,light);col*=.055+daylight*.94;float rim=pow(1.-z,3.5);col+=blue*rim*.6*max(.25,light);col=mix(col,col*vec3(.7,.88,1.16),.22);gl_FragColor=vec4(col,1.);}`;
  const shader=(type,src)=>{const s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
  try{this.program=g.createProgram();g.attachShader(this.program,shader(g.VERTEX_SHADER,vertex));g.attachShader(this.program,shader(g.FRAGMENT_SHADER,fragment));g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))return;g.useProgram(this.program);const b=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,b);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),g.STATIC_DRAW);const p=g.getAttribLocation(this.program,'p');g.enableVertexAttribArray(p);g.vertexAttribPointer(p,2,g.FLOAT,false,0,0);this.uniforms={};for(const n of ['size','radius','center'])this.uniforms[n]=g.getUniformLocation(this.program,n);
  const img=new Image();img.onload=()=>{const tex=g.createTexture();g.bindTexture(g.TEXTURE_2D,tex);g.texImage2D(g.TEXTURE_2D,0,g.RGB,g.RGB,g.UNSIGNED_BYTE,img);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);this.ready=true;onReady();};img.src=new URL('../assets/earth.jpg',import.meta.url).href;
  this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.ready=false;});
  }catch(e){console.warn('Earth shader fallback',e);}
 }
 draw(ctx,w,h,r,lat,lon){if(!this.ready)return false;const key=[w,h,r,lat,lon].join(':');if(key!==this.key){this.key=key;this.canvas.width=w;this.canvas.height=h;const g=this.gl;g.viewport(0,0,w,h);g.useProgram(this.program);g.uniform2f(this.uniforms.size,w,h);g.uniform1f(this.uniforms.radius,r);g.uniform2f(this.uniforms.center,lat*Math.PI/180,lon*Math.PI/180);g.drawArrays(g.TRIANGLES,0,6);}ctx.drawImage(this.canvas,0,0);return true;}
}

