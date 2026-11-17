<template>
    <div class="message-container">
        <div class="message">
            <div class="logo">
                <img class="logo-img" :src="Welcome_data.avatarSrc" alt="logo" />
                <div :class="{ name: true, 'text-hidden': true, long: Welcome_data.nickname.length >= 6 }">
                    <span class="bg">{{ Welcome_data.nickname }}</span>
                </div>
            </div>
            <div class="description cards">
                <div class="content">
                    <span aria-hidden="true">“</span>
                    <div class="text">
                        <p v-for="(line, index) in visibleText" :key="index">{{ line }}</p>
                    </div>
                    <!-- <div class="text">
                        <p>{{ descriptionText.hello }}</p>
                        <p>{{ descriptionText.text1 }}</p>
                        <p>{{ descriptionText.text2 }}</p>
                    </div> -->
                    <span aria-hidden="true">“</span>
                </div>
            </div>
        </div>
    </div>

</template>

<script setup>
import { Welcome_data } from '../js/getdata.js';
const visibleText = Object.values(Welcome_data.descriptionText);
</script>

<style scoped>


p{
    margin: 10px 0 10px 0;
}

.message-container {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    width: 100%;
    padding: 16px;
    box-sizing: border-box;
}

.message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
}

.message .logo {
    display: flex;
    flex-direction: row;
    align-items: center;
    animation: fade 0.5s;
    max-width: 460px;
}

.message .logo .logo-img {
    border-radius: 50%;
    width: 120px;
}

.message .logo .name {
    width: 100%;
    padding-left: 22px;
    /* transform: translateY(-8px); */
    font-family: "sans-serif";
}

.message .logo .name .bg {
    font-size: 5rem;
    font-weight: 900;
}




.message .description {
    padding: 1rem;
    /* margin-top: 3.5rem; */
    max-width: 560px;
    animation: fade 0.5s;
}

.message .description .content {
    display: flex;
    justify-content: space-between;
}

.message .description .content .text {
    font-size: 24px;
    margin: 0.75rem 1rem;
    line-height: 2rem;
    margin-right: auto;
    
}

.message .description .content .text p:nth-of-type(1) {
    font-family: "sans-serif";
}

.message .description .content .xicon:nth-of-type(2) {
    align-self: flex-end;
}

@media (max-width: 720px) {
    .message .description {
        max-width: 100%;
        pointer-events: none;
    }
}



.message .description {
    margin-top: 0rem;
}



@media (max-width: 720px) {
    .message .logo {
        max-width: 100%;
    }
}



@media (max-width: 1400px) {
    .message .logo .logo-img {
        border-radius: 50%;
        width: 100px;
    }
    .message .logo .name .bg {
        font-size: 2rem;
        font-weight: 900;
    }
    .message .description .content .text {
        /* background-color: aqua; */
        font-size: 16px;
        margin: 0.75rem 1rem;
        line-height: 2rem;
        margin-right: auto;
    }
    p{
        margin: 0px;
    }
}

@media (max-width: 480px) {
    .message .logo .logo-img {
        border-radius: 50%;
        width: 100px;
    }

    .message .logo .name .bg {
        font-size: 2rem;
        font-weight: 900;
    }

    .message .description .content .text {
        font-size: 16px;
        margin: 0.75rem 1rem;
        line-height: 2rem;
        margin-right: auto;
    }
}

@media (max-width: 360px) {
    .message .logo .logo-img {
        border-radius: 50%;
        width: 100px;
    }
    .message .logo .name .bg {
        font-size: 2rem;
        font-weight: 900;
    }
    .message .description .content .text {
        /* background-color: aqua; */
        font-size: 14px;
        margin: 0.75rem 1rem;
        line-height: 2rem;
        margin-right: auto;
    }
    p{
        margin: 0px;
    }
}
</style>