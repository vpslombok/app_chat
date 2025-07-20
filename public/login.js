const authContainer = document.getElementById('authContainer');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');

showRegister.onclick = (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
};
showLogin.onclick = (e) => {
    e.preventDefault();
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
};

loginForm.onsubmit = function(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    manualLogin(username, password);
};

function manualLogin(username, password) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://localhost:3000/api/login', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            try {
                var data = JSON.parse(xhr.responseText);
                if (data.success) {
                    localStorage.setItem('token', data.token);
                    window.location.href = 'index.html';
                } else {
                    alert(data.message);
                }
            } catch (e) {
                alert('Terjadi kesalahan pada server.');
            }
        }
    };
    xhr.send(JSON.stringify({ username: username, password: password }));
}

registerForm.onsubmit = function(e) {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    manualRegister(username, password);
};

function manualRegister(username, password) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://localhost:3000/api/register', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            try {
                var data = JSON.parse(xhr.responseText);
                if (data.success) {
                    alert('Register berhasil, silakan login!');
                    registerForm.style.display = 'none';
                    loginForm.style.display = 'block';
                } else {
                    alert(data.message);
                }
            } catch (e) {
                alert('Terjadi kesalahan pada server.');
            }
        }
    };
    xhr.send(JSON.stringify({ username: username, password: password }));
}
