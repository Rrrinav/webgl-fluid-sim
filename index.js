const canvas = document.getElementById("glCanvas");
const gl = canvas.getContext("webgl2");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const SIM_SIZE = 128;

if (!gl) {
  console.error("webgl2 is not supported!");
}
const ext = gl.getExtension("EXT_color_buffer_float");
if (!ext) {
  console.error("floating point textures not supported");
}
// Vertex shader (shared across all programs)
const vertexShaderSource = `#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            out vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

// Fragment shader for velocity diffusion (x component)
const diffusionXShaderSource = `#version 300 es
            precision highp float;
            
            uniform sampler2D u_velocity;
            uniform float u_size;
            uniform float u_dt;
            uniform float u_visc;
            
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            void main() {
                vec2 texelSize = 1.0 / vec2(u_size);
                float center = texture(u_velocity, v_texCoord).x;
                float left = texture(u_velocity, v_texCoord + vec2(-texelSize.x, 0.0)).x;
                float right = texture(u_velocity, v_texCoord + vec2(texelSize.x, 0.0)).x;
                float top = texture(u_velocity, v_texCoord + vec2(0.0, texelSize.y)).x;
                float bottom = texture(u_velocity, v_texCoord + vec2(0.0, -texelSize.y)).x;
                
                float a = u_dt * u_visc * u_size * u_size;
                float value = (center + a * (left + right + top + bottom)) / (1.0 + 4.0 * a);
                fragColor = vec4(value, 0.0, 0.0, 1.0);
            }
        `;

// Fragment shader for velocity diffusion (y component)
const diffusionYShaderSource = `#version 300 es
            precision highp float;
            
            uniform sampler2D u_velocity;
            uniform float u_size;
            uniform float u_dt;
            uniform float u_visc;
            
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            void main() {
                vec2 texelSize = 1.0 / vec2(u_size);
                float center = texture(u_velocity, v_texCoord).y;
                float left = texture(u_velocity, v_texCoord + vec2(-texelSize.x, 0.0)).y;
                float right = texture(u_velocity, v_texCoord + vec2(texelSize.x, 0.0)).y;
                float top = texture(u_velocity, v_texCoord + vec2(0.0, texelSize.y)).y;
                float bottom = texture(u_velocity, v_texCoord + vec2(0.0, -texelSize.y)).y;
                
                float a = u_dt * u_visc * u_size * u_size;
                float value = (center + a * (left + right + top + bottom)) / (1.0 + 4.0 * a);
                fragColor = vec4(value, 0.0, 0.0, 1.0);
            }
        `;

// Fragment shader for visualization
const renderShaderSource = `#version 300 es
    precision mediump float;

    uniform sampler2D u_velocityX;
    uniform sampler2D u_velocityY;

    in vec2 v_texCoord; // Use this directly!
    out vec4 fragColor;

    void main() {
        float vx = texture(u_velocityX, v_texCoord).x;
        float vy = texture(u_velocityY, v_texCoord).x;
        float magnitude = sqrt(vx * vx + vy * vy);
        fragColor = vec4(magnitude, magnitude, magnitude, 1.0);
    }
`;

// Shader compilation helper
function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

// Program creation helper
function createProgram(vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

// Create shader programs
const vertexShader = createShader(gl.VERTEX_SHADER, vertexShaderSource);
const diffusionXProgram = createProgram(
  vertexShader,
  createShader(gl.FRAGMENT_SHADER, diffusionXShaderSource),
);
const diffusionYProgram = createProgram(
  vertexShader,
  createShader(gl.FRAGMENT_SHADER, diffusionYShaderSource),
);
const renderProgram = createProgram(
  vertexShader,
  createShader(gl.FRAGMENT_SHADER, renderShaderSource),
);

// Create buffers
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1, -1, 1, 0,
    1,
  ]),
  gl.STATIC_DRAW,
);

// Create textures and framebuffers for X velocity
function createDoubleBufferTextures() {
  const textures = [];
  const framebuffers = [];

  for (let i = 0; i < 2; i++) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Use RGBA32F instead of R32F for better compatibility
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F, // Changed from R32F
      SIM_SIZE,
      SIM_SIZE,
      0,
      gl.RGBA, // Changed from RED
      gl.FLOAT,
      null,
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.push(texture);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );

    // Check framebuffer status
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("Framebuffer is not complete:", status);
    }

    framebuffers.push(fbo);
  }

  return { textures, framebuffers };
}

const velocityX = createDoubleBufferTextures();
const velocityY = createDoubleBufferTextures();

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

// Initialize velocity data
function initializeVelocityTexture(texture) {
  // Using RGBA format now instead of just RED
  const data = new Float32Array(SIM_SIZE * SIM_SIZE * 4); // * 4 for RGBA
  const centerX = Math.floor(SIM_SIZE / 2);
  const centerY = Math.floor(SIM_SIZE / 2);
  const splatRadius = 20;
  const splatStrength = 1.0;

  for (let y = 0; y < SIM_SIZE; y++) {
    for (let x = 0; x < SIM_SIZE; x++) {
      const index = (y * SIM_SIZE + x) * 4; // * 4 for RGBA
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < splatRadius) {
        data[index] = splatStrength * (1.0 - distance / splatRadius);
        // Set other channels to 0
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 1; // Alpha channel
      } else {
        data[index] = 0; // R channel
        data[index + 1] = 0; // G channel
        data[index + 2] = 0; // B channel
        data[index + 3] = 1; // Alpha channel
      }
    }
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    SIM_SIZE,
    SIM_SIZE,
    gl.RGBA, // Changed from RED
    gl.FLOAT,
    data,
  );
}

initializeVelocityTexture(velocityX.textures[0]);
initializeVelocityTexture(velocityY.textures[0]);

// Simulation parameters
const params = {
  dt: 0.0000016,
  diffusion: 0.0000000001,
  iterations: 5,
};

let currentX = 0;
let currentY = 0;

function render() {
  for (let i = 0; i < params.iterations; i++) {
    // Diffuse X velocity
    gl.useProgram(diffusionXProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, velocityX.framebuffers[currentX ^ 1]);
    gl.viewport(0, 0, SIM_SIZE, SIM_SIZE);

    gl.uniform1f(gl.getUniformLocation(diffusionXProgram, "u_size"), SIM_SIZE);
    gl.uniform1f(gl.getUniformLocation(diffusionXProgram, "u_dt"), params.dt);
    gl.uniform1f(gl.getUniformLocation(diffusionXProgram, "u_visc"), SIM_SIZE);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocityX.textures[currentX]);
    gl.uniform1i(gl.getUniformLocation(diffusionXProgram, "u_velocity"), 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    currentX ^= 1;

    // Diffuse Y velocity
    gl.useProgram(diffusionYProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, velocityY.framebuffers[currentY ^ 1]);

    gl.uniform1f(
      gl.getUniformLocation(diffusionYProgram, "u_size"),
      canvas.width,
    );
    gl.uniform1f(gl.getUniformLocation(diffusionYProgram, "u_dt"), params.dt);
    gl.uniform1f(
      gl.getUniformLocation(diffusionYProgram, "u_visc"),
      params.diffusion,
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocityY.textures[currentY]);
    gl.uniform1i(gl.getUniformLocation(diffusionYProgram, "u_velocity"), 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    currentY ^= 1;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  // Render to screen
  gl.useProgram(renderProgram);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, velocityX.textures[currentX]);
  gl.uniform1i(gl.getUniformLocation(renderProgram, "u_velocityX"), 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, velocityY.textures[currentY]);
  gl.uniform1i(gl.getUniformLocation(renderProgram, "u_velocityY"), 1);
  // gl.uniform2f(
  //   gl.getUniformLocation(renderProgram, "u_resolution"),
  //   canvas.width,
  //   canvas.height,
  // );
  // gl.uniform2f(
  //   gl.getUniformLocation(renderProgram, "u_simResolution"),
  //   SIM_SIZE,
  //   SIM_SIZE,
  // );

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  requestAnimationFrame(render);
}

// Set up vertex attributes
const positionLoc = gl.getAttribLocation(diffusionXProgram, "a_position");
const texCoordLoc = gl.getAttribLocation(diffusionXProgram, "a_texCoord");

gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.enableVertexAttribArray(positionLoc);
gl.enableVertexAttribArray(texCoordLoc);
gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 16, 0);
gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 16, 8);

function handleResize(gl, canvas) {
  // Resize the canvas to the display size (CSS pixels)
  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;

  // Check if the canvas needs resizing
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    // Set the canvas size to match the display size
    canvas.width = displayWidth;
    canvas.height = displayHeight;

    // Update the WebGL viewport to match the new canvas size
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }
}

window.addEventListener("resize", () => handleResize(gl, canvas));

// Initial setup
handleResize(gl, canvas);

render();
