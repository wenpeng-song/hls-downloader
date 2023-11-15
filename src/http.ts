import * as fs from "fs";
import axios from "axios";

export type HttpHeaders = { [name: string]: string };

export async function get(url: string, headers?: HttpHeaders): Promise<string> {
    const response = await axios.get(url, { responseType: "text", headers });
    return response.data;
}

export async function getWithRetries(url: string, headers?: HttpHeaders, maxRetries: number = 3, currentTry = 1): Promise<string> {
    if (currentTry > maxRetries) {
        throw new Error(`too many retries - download playlist(${url}) failed`)
    }
    try {
        const response = await get(url, headers);
        return response;
    } catch (err) {
        return getWithRetries(url, headers, maxRetries, ++currentTry);
    }
}

export async function download(url: string, file: string, headers?: HttpHeaders): Promise<void> {
    const response = await axios(url, { responseType: "stream", headers });
    const stream = response.data.pipe(fs.createWriteStream(file));
    return new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
    });
}
