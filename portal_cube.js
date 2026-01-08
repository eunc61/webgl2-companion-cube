import {
    mat4,
    mat3,
    vec3,
} from "https://cdn.jsdelivr.net/npm/gl-matrix@3.4.4/esm/index.js";


// =================================================================
// 0. 초기화 및 전역 변수 설정
// =================================================================
const canvas = document.getElementById("glcanvas");
if (!canvas) throw new Error("Canvas element with id 'glcanvas' not found.");

const gl = canvas.getContext("webgl2");
if (!gl) throw new Error("WebGL2 not supported");

canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;
gl.viewport(0, 0, canvas.width, canvas.height);


let state = {
    cubeY: 5.0,           // 큐브 높이
    cubeRot: 0.0,         // 큐브 회전각
    fallSpeed: 0.05,      // 낙하 속도
    isPaused: false,      // 일시정지 여부
    camYaw: -Math.PI / 2, // 카메라 좌우 회전
    camPitch: 0.5,        // 카메라 상하 회전
    camDist: 15.0         // 카메라 거리
};


// =================================================================
// 1. 셰이더 정의 (Phong + Texture + 2 Point Lights)
// =================================================================

const vs = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMat;

out vec3 vNormal;
out vec3 vFragPos; // 조명 계산을 위한 월드 좌표
out vec2 vTexCoord;

void main() {
    vec4 worldPos = uModel * vec4(aPosition, 1.0);
    // aPosition을 모델 행렬로 변환하여 월드 위치 계산
    vFragPos = worldPos.xyz;
    //조명 계산을 위해 월드 위치를 출력변수로 전달
    vNormal = normalize(uNormalMat * aNormal);
    //법선 벡터를 노멀 매트릭스로 변환하고 정규화하여 월드 법선을 계산
    vTexCoord = aTexCoord;
    //텍스처 좌표를 프래그먼트셰이더로 전달
    gl_Position = uProj * uView * worldPos; // <-- 수정 완료
    //뷰행렬 투영행렬 곱하여 정점 화면좌표 계산
}
`;

const fs = `#version 300 es
precision highp float;

// 재질 & 텍스처
uniform sampler2D uTexture;
uniform vec3 uColorTint;
uniform float uUseTexture;

// 조명 (Light 1: Orange-Top, Light 2: Blue-Bottom)
uniform vec3 uLight1Pos;
uniform vec3 uLight1Color;
uniform vec3 uLight2Pos;
uniform vec3 uLight2Color;

uniform vec3 uViewPosCam; // 카메라 월드 위치
uniform float uShininess;
uniform float uAmbientStrength;

in vec3 vNormal;
in vec3 vFragPos;
in vec2 vTexCoord;

out vec4 outColor;

// 퐁 쉐이딩 계산 함수
vec3 calcPointLight(vec3 lightPos, vec3 lightColor, vec3 normal, vec3 viewDir) {
    vec3 lightDir = normalize(lightPos - vFragPos);
    
    float diff = max(dot(normal, lightDir), 0.0);
    // 법선과 광원 방향 내적을 통해 난반사 계수 계산
    vec3 reflectDir = reflect(-lightDir, normal);
    //광원 방향을 법선에 대해 반사시켜 반사 벡터를 계산
    float spec = pow(max(dot(viewDir, reflectDir), 0.0), uShininess);
    //반사 벡터와 시선 방향 내적 후 uShininess 제곱하여 정반사 강도를 계산 
    float distance = length(lightPos - vFragPos);
    float attenuation = 1.0 / (1.0 + 0.09 * distance + 0.032 * (distance * distance));
    //광원과의 거리에 따라 빛 감쇠 적용
    vec3 ambient = uAmbientStrength * lightColor;
    //주변광 계산
    vec3 diffuse = diff * lightColor;
    //난반사 최종 색상 계산
    vec3 specular = spec * vec3(1.0) * 1.5; 
    //정반사 최종 색상 계산
    return (ambient + diffuse + specular) * attenuation;
    //세가지 조명요소를 합산하고 감쇠율을 곱하여 최종 조명 결과 반환
}
//색상 합성 및 출력
void main() {
    vec3 N = normalize(vNormal);
    //보간된 법선 벡터 정규화

    vec3 V = normalize(uViewPosCam - vFragPos);
    //카메라 위치에서 사선벡터 계산

    // 두 개의 조명 합치기
    vec3 result = calcPointLight(uLight1Pos, uLight1Color, N, V);
    result += calcPointLight(uLight2Pos, uLight2Color, N, V);
    //주황색과 파란색 두 광원의 조명결과를 합침

    // 객체 기본 색상 가져오기 (텍스처 vs 단색)
    vec4 baseColor;
    if (uUseTexture > 0.5) {
        baseColor = texture(uTexture, vTexCoord);
        //uUseTexture값이 1이면 텍스처에서 색상 샘플링

    } else {
        baseColor = vec4(uColorTint, 1.0);
        //0이면 단색을 기본 색상으로 사용
    }

    // 최종 색상 합성
    outColor = vec4(result * baseColor.rgb, baseColor.a);
}
`;


const program = initShaderProgram(gl, vs, fs);
gl.useProgram(program);


// =================================================================
// 2. 객체 생성 (Cube)
// =================================================================

const cubeData = createCubeWithUV(1.0);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

createVBO(gl, 0, new Float32Array(cubeData.positions), 3);
createVBO(gl, 1, new Float32Array(cubeData.normals), 3);
createVBO(gl, 2, new Float32Array(cubeData.texCoords), 2);

const ibo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(cubeData.indices), gl.STATIC_DRAW);


// =================================================================
// 3. 텍스처 로딩 (Companion Cube)
// =================================================================

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
// 임시 흰색 픽셀 데이터 (로드 실패 대비)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

const image = new Image();
image.src = "companion_cube.jpg"; 
image.crossOrigin = "Anonymous"; 


// =================================================================
// 4. Uniform 위치 가져오기
// =================================================================

const uModel = gl.getUniformLocation(program, "uModel");
const uView = gl.getUniformLocation(program, "uView");
const uProj = gl.getUniformLocation(program, "uProj");
const uNormalMat = gl.getUniformLocation(program, "uNormalMat");
const uViewPosCam = gl.getUniformLocation(program, "uViewPosCam");

const uLight1Pos = gl.getUniformLocation(program, "uLight1Pos");
const uLight1Color = gl.getUniformLocation(program, "uLight1Color");
const uLight2Pos = gl.getUniformLocation(program, "uLight2Pos");
const uLight2Color = gl.getUniformLocation(program, "uLight2Color");

const uShininess = gl.getUniformLocation(program, "uShininess");
const uAmbientStrength = gl.getUniformLocation(program, "uAmbientStrength");
const uUseTexture = gl.getUniformLocation(program, "uUseTexture");
const uColorTint = gl.getUniformLocation(program, "uColorTint");


// =================================================================
// 5. 이벤트 리스너 (인터랙션 구현)
// =================================================================

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') state.isPaused = !state.isPaused;
    // 화살표 키가 기본 스크롤 동작을 막도록 preventDefault() 추가
    if (e.code === 'ArrowUp') {
        state.fallSpeed = Math.min(1.0, state.fallSpeed + 0.01); // 최대 속도 제한
        e.preventDefault();
    }
    if (e.code === 'ArrowDown') {
        state.fallSpeed = Math.max(0, state.fallSpeed - 0.01);
        e.preventDefault();
    }
});

let isDragging = false;
let lastMouseX = 0, lastMouseY = 0;

canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});
window.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    state.camYaw -= dx * 0.005;
    state.camPitch -= dy * 0.005;

    // 카메라 상하 회전 제한
    state.camPitch = Math.max(-1.5, Math.min(1.5, state.camPitch));
});


// =================================================================
// 6. 렌더링 루프 (이미지 로드 후 시작)
// =================================================================

gl.enable(gl.DEPTH_TEST);

const proj = mat4.create();
mat4.perspective(proj, Math.PI / 4, canvas.width / canvas.height, 0.1, 100);
gl.uniformMatrix4fv(uProj, false, proj);

// 조명 설정 (고정)
gl.uniform3fv(uLight1Pos, [0.0, 4.5, 0.0]);
gl.uniform3fv(uLight1Color, [1.0, 0.5, 0.0]); // 주황색
gl.uniform3fv(uLight2Pos, [0.0, -4.5, 0.0]);
gl.uniform3fv(uLight2Color, [0.0, 0.5, 1.0]); // 파란색
gl.uniform1f(uShininess, 64.0);
gl.uniform1f(uAmbientStrength, 0.1);


image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    
    if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
    
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    
    gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);

    requestAnimationFrame(render);
}

function render() {
    
    if (!state.isPaused) {
        state.cubeY -= state.fallSpeed;
        state.cubeRot += 0.01;

        if (state.cubeY < -5.0) {
            state.cubeY = 5.0; // 무한 루프
        }
    }

    // 화면 클리어
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 카메라 뷰 행렬 계산
    const view = mat4.create();
    const camX = Math.sin(state.camYaw) * state.camDist * Math.cos(state.camPitch);
    const camY = Math.sin(state.camPitch) * state.camDist;
    const camZ = Math.cos(state.camYaw) * state.camDist * Math.cos(state.camPitch);
    const camPos = [camX, camY, camZ];

    mat4.lookAt(view, camPos, [0, 0, 0], [0, 1, 0]);
    gl.uniformMatrix4fv(uView, false, view);
    gl.uniform3fv(uViewPosCam, camPos);

    gl.bindVertexArray(vao);

    // 텍스처 유닛 바인딩
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // 컴패니언 큐브 그리기
    const modelCube = mat4.create();
    mat4.translate(modelCube, modelCube, [0, state.cubeY, 0]);
    mat4.rotate(modelCube, modelCube, state.cubeRot, [1, 1, 0]);
    mat4.scale(modelCube, modelCube, [0.8, 0.8, 0.8]);

    drawObject(modelCube, true, [1, 1, 1]); // 텍스처 사용

    // 천장 포탈 (주황색 링) 
    const modelTop = mat4.create();
    mat4.translate(modelTop, modelTop, [0, 5.0, 0]);
    mat4.scale(modelTop, modelTop, [2.0, 0.1, 2.0]);

    drawObject(modelTop, false, [1.0, 0.5, 0.0]); // 텍스처 X, 주황색

    // 바닥 포탈 (파란색 링) 
    const modelBot = mat4.create();
    mat4.translate(modelBot, modelBot, [0, -5.0, 0]);
    mat4.scale(modelBot, modelBot, [2.0, 0.1, 2.0]);

    drawObject(modelBot, false, [0.0, 0.5, 1.0]); // 텍스처 X, 파란색

    requestAnimationFrame(render);
}

// 객체 그리기 헬퍼 함수
function drawObject(modelMatrix, useTexture, color) {
    gl.uniformMatrix4fv(uModel, false, modelMatrix);

    const normalMat = mat3.create();
    mat3.normalFromMat4(normalMat, modelMatrix);
    gl.uniformMatrix3fv(uNormalMat, false, normalMat);

    gl.uniform1f(uUseTexture, useTexture ? 1.0 : 0.0);
    gl.uniform3fv(uColorTint, color);

    gl.drawElements(gl.TRIANGLES, cubeData.indices.length, gl.UNSIGNED_INT, 0);
}

// =================================================================
// 7. 유틸리티 함수들 (오류 검사 포함)
// =================================================================

function createVBO(gl, loc, data, size) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

function initShaderProgram(gl, vsSource, fsSource) {
    const v = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const f = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error("SHADER LINK FAILED:", gl.getProgramInfoLog(p));
    }
    return p;
}

function compileShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("SHADER COMPILE FAILED:", gl.getShaderInfoLog(s));
    }
    return s;
}

// 큐브 생성 함수
function createCubeWithUV(side) {
    const s = side / 2;
    const positions = [
        // Front face
        -s, -s, s, s, -s, s, s, s, s, -s, s, s,
        // Back face
        -s, -s, -s, -s, s, -s, s, s, -s, s, -s, -s,
        // Top face
        -s, s, -s, -s, s, s, s, s, s, s, s, -s,
        // Bottom face
        -s, -s, -s, s, -s, -s, s, -s, s, -s, -s, s,
        // Right face
        s, -s, -s, s, s, -s, s, s, s, s, -s, s,
        // Left face
        -s, -s, -s, -s, -s, s, -s, s, s, -s, s, -s,
    ];
    const normals = [
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
        0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
        0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
        1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
        -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    ];
    const texCoords = [
        0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0,
        1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0,
        1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0,
        1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0,
    ];
    const indices = [
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23
    ];
    return { positions, normals, texCoords, indices };
}

// 2의 거듭제곱인지 확인하는 유틸리티 함수 (이미지 로드 수정에 사용됨)
function isPowerOf2(value) {
    return (value & (value - 1)) == 0;
}