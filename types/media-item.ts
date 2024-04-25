export type Media = {
    name: string,
    url: string,
    type: MEDIA_TYPE,
    from: string,
    index: number,
    state: MEDIA_STATE
}
export enum MEDIA_STATE {
    WAITING = 0,
    PLAYING = 1,
    ENDED = 2,
    REMOVED = 3
}
export enum MEDIA_TYPE {
    AUDIO = 'audio',
    VIDEO = 'video'
}