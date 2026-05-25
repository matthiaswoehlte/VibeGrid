// /storyboard renders the same studio shell as /, but the pathname-
// watching effect inside StudioPage will set appMode='sceneflow' on
// mount so SceneFlow is the visible tab. Re-exporting keeps a single
// implementation and lets browser back/forward + bookmarks just work.
export { default } from '@/app/(studio)/page';
